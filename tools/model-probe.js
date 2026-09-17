#!/usr/bin/env node
// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with section 7 terms; see LICENSE.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveVendorBinary } = require('./vendor-binaries.js');
const { subscriptionEnv } = require('./cli-adapters.js');
const { loadMatrix } = require('./dispatch-matrix.js');
const { runLaunch } = require('./cli-runner.js');
const { verifyProof } = require('./cli-proof.js');
const { finalResponse, nativeLog } = require('./vendor-native.js');
const { compareWorkspace, hashFile, inside, snapshotWorkspace, writeJson } = require('./dispatch-evidence.js');
const { canonicalPlainPath, pathsOverlap, DEFAULT_ROOT } = require('./runtime-paths.js');
const { challengeMatches } = require('./probe-evidence.js');

async function probe({ vendor, model, effort, evidenceDir, cwd, maxWallMs = 120000 }, dependencies = {}) {
  const spec = loadMatrix().vendors?.[vendor]?.models?.[model];
  if (!spec?.efforts.includes(effort)) throw new Error('probe model/effort is outside the vendor catalog');
  if (!Number.isSafeInteger(maxWallMs) || maxWallMs < 1 || maxWallMs > 120000) throw new Error('maxWallMs must be an integer between 1 and 120000');
  if (!evidenceDir) throw new Error('probe evidenceDir is required');
  const root = path.resolve(evidenceDir);
  const work = path.resolve(cwd || path.join(root, 'workspace'));
  const canonicalRoot = canonicalPlainPath(root);
  const canonicalWork = canonicalPlainPath(work);
  if (inside(canonicalRoot, canonicalWork)) throw new Error('probe evidence directory must be outside its workspace');
  const runtime = canonicalPlainPath(DEFAULT_ROOT);
  if ([canonicalRoot, canonicalWork].some(file => pathsOverlap(file, runtime))) throw new Error('probe paths must be outside the runtime');
  if (cwd && (!fs.existsSync(work) || !fs.statSync(work).isDirectory())) throw new Error('explicit probe cwd must be an existing directory');
  if (fs.existsSync(root) && fs.readdirSync(root).length) throw new Error('probe evidence directory must be new or empty');
  const binary = resolveVendorBinary(vendor);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const challenge = `MAGI_PROBE_${crypto.randomBytes(16).toString('hex')}`;
  const prompt = `Reply with exactly ${challenge} in your final response. Do not use tools. Do not modify any files.\n`;
  const stdinFile = path.join(root, 'challenge.txt');
  fs.writeFileSync(stdinFile, prompt, 'utf8');
  const capture = path.join(root, 'capture.txt');
  const log = path.join(root, 'vendor.log');
  const nativeLogPath = vendor === 'google' ? path.join(root, 'native-cli.log') : undefined;
  const env = { ...subscriptionEnv(), AGY_CLI_DISABLE_AUTO_UPDATE: 'true' };
  if (vendor === 'anthropic') {
    const auth = JSON.parse(execFileSync(binary, ['auth', 'status'], { env, encoding: 'utf8', timeout: 15000 }));
    if (auth.loggedIn !== true || auth.authMethod !== 'claude.ai') throw new Error('Claude subscription authentication is not available');
    writeJson(path.join(root, 'auth-status.json'), { loggedIn: true, authMethod: auth.authMethod });
  }
  let args;
  // Same provider override as cli-adapters.openaiLaunch: headless codex otherwise
  // routes through the host's local proxy, which is usually down on this Mac.
  const provider = process.env.MAGI_CODEX_PROVIDER ?? (process.platform === 'darwin' ? 'openai' : undefined);
  if (vendor === 'openai') args = ['exec', '--skip-git-repo-check', '-s', 'read-only', '-m', model, '-c', `model_reasoning_effort=${effort}`, '-c', 'memories.use_memories=false', '-c', 'memories.generate_memories=false', ...(provider ? ['-c', `model_provider=${provider}`] : []), '-C', work, '-o', capture, '-'];
  if (vendor === 'google') args = ['--model', model, '--sandbox', '--output-format', 'json', '--print-timeout', '2m', '--log-file', nativeLogPath, '--add-dir', work, '-p', prompt];
  if (vendor === 'anthropic') args = ['-p', '--safe-mode', '--model', model, '--effort', effort, '--permission-mode', 'dontAsk', '--tools', '', '--output-format', 'stream-json', '--verbose'];
  const launch = { vendor, binary, args, env, cwd: work, stdinFile, stdio: vendor === 'google' ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'] };
  const startedAt = new Date().toISOString();
  writeJson(path.join(root, 'launch.json'), { vendor, model, effort, binary, args, cwd: work, startedAt });
  const before = snapshotWorkspace(work);
  try {
  const result = await (dependencies.runLaunch || runLaunch)(launch, { pidFile: path.join(root, 'child.pid'), stdoutFile: path.join(root, 'stdout.log'), stderrFile: path.join(root, 'stderr.log'), maxWallMs });
  const completedAt = new Date().toISOString();
  writeJson(path.join(root, 'process-result.json'), { ...result, stdout: undefined, stderr: undefined, startedAt, completedAt });
  const audit = compareWorkspace(before, snapshotWorkspace(work), []);
  writeJson(path.join(root, 'scope-audit.json'), audit);
  if (vendor !== 'openai') fs.writeFileSync(capture, result.stdout, 'utf8');
  fs.writeFileSync(log, vendor === 'openai' ? result.stderr : `${result.stderr}\n${result.stdout}`, 'utf8');
  if (!result.ok) {
    writeJson(path.join(root, 'probe.json'), { status: 'FAIL', vendor, model, effort, startedAt, completedAt: new Date().toISOString(), exitCode: result.exitCode, killReason: result.killReason });
    throw new Error(`probe failed: exit=${result.exitCode} ${result.killReason || ''}`);
  }
  if (!audit.ok) throw new Error('read-only model probe changed workspace files');
  const text = fs.readFileSync(capture, 'utf8');
  fs.writeFileSync(log, nativeLog(vendor, text, fs.readFileSync(log, 'utf8'), { cwd: work, nativeLogPath }), 'utf8');
  const proof = verifyProof({ vendor, capture, log, expectedModel: model, expectedObservedModel: spec.canonical || model, expectedEffort: effort, expectedSandbox: vendor === 'openai' ? 'read-only' : undefined, onTopic: true });
  if (!challengeMatches(finalResponse(vendor, text), challenge)) throw new Error('probe challenge response mismatch');
  const record = { schemaVersion: 1, status: 'PASS', vendor, requestedModel: model, observedModel: proof.modelObserved, effort, startedAt, completedAt, challenge, capture, log, captureSha256: hashFile(capture), logSha256: hashFile(log), proof };
  writeJson(path.join(root, 'probe.json'), record);
  return { ...record, probeFile: path.join(root, 'probe.json') };
  } catch (error) {
    const cleanup = { errorCode: error.code || null, pid: error.pid ?? null, exitConfirmed: error.exitConfirmed ?? null };
    if (error.exitConfirmed === false) writeJson(path.join(root, 'scope-audit.json'), { ok: false, complete: false, reason: 'child exit is unconfirmed; no final workspace evidence', ...cleanup });
    writeJson(path.join(root, 'probe.json'), { schemaVersion: 1, status: 'FAIL', vendor, requestedModel: model, effort, startedAt, completedAt: new Date().toISOString(), error: error.message, ...cleanup });
    throw error;
  }
}
function parseArgs(argv) {
    const opts = {};
    const seen = new Set();
    for (let i = 0; i < argv.length; i += 2) {
      if (seen.has(argv[i])) throw new Error(`duplicate option: ${argv[i]}`);
      seen.add(argv[i]);
      if (!['--vendor', '--model', '--effort', '--evidence-dir', '--cwd'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Usage: model-probe --vendor <vendor> --model <model> --effort <effort> --evidence-dir <new directory>');
      opts[argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[i + 1];
    }
    return opts;
}
async function main(argv = process.argv.slice(2)) {
  try {
    const opts = parseArgs(argv);
    const result = await probe(opts);
    process.stdout.write(`${JSON.stringify({ status: result.status, vendor: result.vendor, requestedModel: result.requestedModel, observedModel: result.observedModel, effort: result.effort, probeFile: result.probeFile })}\n`); return 0;
  } catch (error) { process.stderr.write(`MODEL_PROBE_FAIL: ${error.message}\n`); return 1; }
}
if (require.main === module) main().then((code) => { process.exitCode = code; });
module.exports = { main, parseArgs, probe };
