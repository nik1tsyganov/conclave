#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildLaunch, DEFAULTS } = require('./cli-adapters.js');
const { runLaunch } = require('./cli-runner.js');
const { stageRules, verifyStagedRules } = require('./cli-rules-stage.js');
const { checkBriefFile } = require('./cli-brief-rules-check.js');
const { verifyProof } = require('./cli-proof.js');
const { validateDispatchRow } = require('./dispatch-schema.js');
const { loadMatrix, loadAvailability, routeAllowed } = require('./dispatch-matrix.js');

function argError(message) { const e = new Error(message); e.code = 'ARGUMENT_ERROR'; return e; }

function parseArgs(argv) {
  const out = { onTopic: false };
  const values = new Set([
    '--vendor', '--role', '--class', '--brief', '--cwd', '--model', '--effort', '--dispatch-id', '--unit-id',
    '--evidence-dir', '--telemetry-log', '--activation-log', '--rules-root', '--review-permission-mode',
    '--matrix', '--availability',
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--on-topic') { out.onTopic = true; continue; }
    if (flag === '--help' || flag === '-h') { out.help = true; continue; }
    if (!values.has(flag)) throw argError(`unknown option: ${flag}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw argError(`${flag} requires a value`);
    out[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return out;
}

function usage() {
  return [
    'Usage: node tools/dispatch-run.js --vendor <openai|google|anthropic> --role <implement|review|verify>',
    '  --class <routing-class> --brief <BRIEF.md> --cwd <worktree> --dispatch-id <id> --unit-id <id> --evidence-dir <dir>',
    '  [--model <slug>] [--effort <level>] [--availability <json>] [--rules-root <dir>] [--on-topic]',
    '',
    'Runs one fail-closed MAGI CLI seat transaction. The dispatch matrix is enforced again here, at the launch boundary.',
  ].join('\n');
}

function required(opts) {
  for (const key of ['vendor', 'role', 'class', 'brief', 'cwd', 'dispatchId', 'unitId', 'evidenceDir']) {
    if (!opts[key]) throw argError(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
  }
  if (!['openai', 'google', 'anthropic'].includes(opts.vendor)) throw argError('invalid --vendor');
  if (!['implement', 'review', 'verify'].includes(opts.role)) throw argError('invalid --role');
}

function defaultEffort(vendor, model) {
  if (vendor !== 'google') return DEFAULTS[vendor].effort;
  if (/-high$/i.test(model)) return 'fused-high';
  if (/-medium$/i.test(model)) return 'fused-medium';
  if (/-low$/i.test(model)) return 'fused-low';
  return 'fused';
}

function hashText(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function appendJsonl(file, row) { fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true }); fs.appendFileSync(path.resolve(file), `${JSON.stringify(row)}\n`, 'utf8'); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }

async function runDispatch(opts) {
  required(opts);
  const brief = path.resolve(opts.brief);
  const evidenceDir = path.resolve(opts.evidenceDir);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const model = opts.model || DEFAULTS[opts.vendor].model;
  const effort = opts.effort || defaultEffort(opts.vendor, model);
  const matrix = loadMatrix(opts.matrix);
  const availability = loadAvailability(opts.availability);
  const policy = routeAllowed(matrix, { class: opts.class, role: opts.role, vendor: opts.vendor, model, effort }, availability);
  if (!policy.ok) {
    const error = new Error(policy.reason);
    error.code = 'POLICY_FAIL';
    throw error;
  }

  const staged = stageRules({ briefPath: brief, rulesRoot: opts.rulesRoot });
  verifyStagedRules(brief);
  const briefCheck = checkBriefFile(brief, { role: opts.role, vendor: opts.vendor, requireStructural: true });
  if (!briefCheck.ok) {
    const error = new Error(`brief gate failed: ${briefCheck.missing.join(', ')}`);
    error.code = 'RULES_FAIL';
    throw error;
  }

  const capturePath = path.join(evidenceDir, 'capture.txt');
  const stdoutPath = path.join(evidenceDir, 'stdout.log');
  const stderrPath = path.join(evidenceDir, 'stderr.log');
  const pidFile = path.join(evidenceDir, 'child.pid');
  for (const file of [capturePath, stdoutPath, stderrPath]) fs.rmSync(file, { force: true });

  const launch = buildLaunch({
    vendor: opts.vendor, role: opts.role, briefPath: brief, cwd: opts.cwd, model,
    effort: opts.vendor === 'google' ? undefined : effort,
    capturePath, rulesRoot: staged.rulesRoot, reviewPermissionMode: opts.reviewPermissionMode,
  });
  writeJson(path.join(evidenceDir, 'launch.json'), {
    class: opts.class, vendor: launch.vendor, role: launch.role, model, effort,
    binary: launch.binary, args: launch.args, cwd: launch.cwd,
  });

  const result = await runLaunch(launch, { pidFile, stdoutFile: stdoutPath, stderrFile: stderrPath });
  if (!result.ok) {
    const error = new Error(`vendor child failed exit=${result.exitCode}${result.killReason ? ` reason=${result.killReason}` : ''}`);
    error.code = 'LAUNCH_FAIL';
    throw error;
  }

  if (opts.vendor !== 'openai') fs.writeFileSync(capturePath, result.stdout, 'utf8');
  else if (!fs.existsSync(capturePath)) fs.writeFileSync(capturePath, result.stdout, 'utf8');
  const combinedLog = `${result.stderr}\n${result.stdout}`;
  fs.writeFileSync(path.join(evidenceDir, 'vendor.log'), combinedLog, 'utf8');

  const proof = verifyProof({
    vendor: opts.vendor, capture: capturePath, log: path.join(evidenceDir, 'vendor.log'),
    expectedModel: model, expectedEffort: effort, onTopic: opts.onTopic,
  });
  const proofId = hashText(JSON.stringify(proof));
  writeJson(path.join(evidenceDir, 'proof.json'), { proofId, ...proof });

  const now = new Date();
  const telemetry = validateDispatchRow({
    schemaVersion: 1, date: now.toISOString().slice(0, 10), dispatchId: opts.dispatchId, unitId: opts.unitId,
    class: opts.class, vendor: opts.vendor, role: opts.role, hostMode: 'cursor-cli', routedBy: 'arbiter', capturedBy: 'lead',
    model, effort, proofId, vendorSideTokens: proof.vendorSideTokens ?? null, note: `evidence=${evidenceDir}`,
  }, { requireCursorCli: true, requireArbiter: true, requireDispatchId: true, requireUnitId: true, requireProof: true });

  const telemetryLog = opts.telemetryLog || path.resolve(__dirname, '..', 'telemetry', 'dispatches.jsonl');
  appendJsonl(telemetryLog, telemetry);
  if (opts.role === 'implement') appendJsonl(opts.activationLog || path.resolve(__dirname, '..', 'magi-dispatch-log.jsonl'), telemetry);

  const receipt = {
    schemaVersion: 1, dispatchId: opts.dispatchId, unitId: opts.unitId, class: opts.class, vendor: opts.vendor, role: opts.role,
    model, effort, proofId,
    briefSha256: crypto.createHash('sha256').update(fs.readFileSync(brief)).digest('hex'),
    captureSha256: crypto.createHash('sha256').update(fs.readFileSync(capturePath)).digest('hex'),
    rulesManifest: staged.manifestPath, completedAt: now.toISOString(),
  };
  writeJson(path.join(evidenceDir, 'receipt-ack.json'), receipt);
  writeJson(path.join(evidenceDir, 'handoff-envelope.json'), { ...receipt, telemetryLog, status: 'PASS' });
  return { ok: true, proofId, receipt, telemetry };
}

async function main(argv = process.argv.slice(2), io = process) {
  try {
    const opts = parseArgs(argv);
    if (opts.help) { io.stdout.write(`${usage()}\n`); return 0; }
    const result = await runDispatch(opts);
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const code = error.code || 'DISPATCH_FAIL';
    io.stderr.write(`${code}: ${error.message}\n`);
    return code === 'ARGUMENT_ERROR' || code === 'BINARY_MISSING' || code === 'RULES_SOURCE_MISSING' ? 2 : 1;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });
module.exports = { appendJsonl, defaultEffort, main, parseArgs, runDispatch };
