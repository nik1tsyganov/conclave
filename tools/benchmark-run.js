#!/usr/bin/env node
'use strict';

// Host experiment controller. This module never grades semantic quality or
// replaces MAGI's native proof, sealing, attestation, or replay validators.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { canonicalPlainPath, pathsOverlap, resolveRuntimePaths } = require('./runtime-paths');
const { assertPlainPath, hashFile, transactionKey } = require('./dispatch-evidence');

const VERSION = 'benchmark-run-v1';
const SUBJECTS = Object.freeze([
  ['luna', 'openai', 'gpt-5.6-luna', 'medium'], ['terra', 'openai', 'gpt-5.6-terra', 'medium'],
  ['sol', 'openai', 'gpt-5.6-sol', 'high'], ['astra', 'openai', 'gpt-6-astra', 'high'],
  ['sonnet', 'anthropic', 'sonnet', 'medium'], ['opus', 'anthropic', 'opus', 'high'], ['fable', 'anthropic', 'fable', 'xhigh'],
  ['pro', 'google', 'gemini-3.1-pro-high', 'fused-high'], ['flashh', 'google', 'gemini-3.8-flash-high', 'fused-high'],
  ['flashm', 'google', 'gemini-3.8-flash-medium', 'fused-medium'], ['flashl', 'google', 'gemini-3.8-flash-low', 'fused-low'],
].map(([id, vendor, model, effort]) => Object.freeze({ id, vendor, model, effort })));
const FABLE_DIAGNOSTIC = Object.freeze({ id: 'fableh', vendor: 'anthropic', model: 'fable', effort: 'high', diagnostic: true });
const MODES = ['init', 'prepare', 'probe', 'run', 'attest', 'judge', 'status'];
const safeId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => { assertPlainPath(file); return JSON.parse(fs.readFileSync(file, 'utf8')); };
function write(file, value) { assertPlainPath(file); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
function required(condition, message) { if (!condition) throw new Error(message); }
function boundWrite(file, value) { write(file, value); fs.writeFileSync(file + '.sha256', hashFile(file) + '\n', { flag: 'wx' }); }
function boundRead(file) { required(hashFile(file) === fs.readFileSync(file + '.sha256', 'utf8').trim(), 'Bound record changed: ' + file); return read(file); }
function filesUnder(root) {
  const files = [];
  function walk(dir) { for (const name of fs.readdirSync(dir).sort()) { const file = path.join(dir, name); assertPlainPath(file); const stat = fs.statSync(file); if (stat.isDirectory()) walk(file); else if (stat.isFile()) files.push(file); } }
  walk(root); return files;
}
function fingerprint(files) { return [...new Set(files)].sort().map(file => ({ path: canonicalPlainPath(file), sha256: hashFile(file) })); }
function checkHashes(entries) { for (const entry of entries) { assertPlainPath(entry.path); required(hashFile(entry.path) === entry.sha256, 'Frozen file changed: ' + entry.path); } }
function freezeInventory(runtime, source, rulesRoot) {
  return fingerprint([...filesUnder(runtime.toolsDir).filter(file => file.endsWith('.js') && !file.endsWith('.test.js')), ...filesUnder(runtime.referencesDir), ...filesUnder(runtime.seatSkillsRoot), ...filesUnder(rulesRoot),
    path.join(runtime.templatesDir, 'brief-rules-block.md'), path.join(source, 'tools', 'benchmark-fixtures.js'), path.join(source, 'tools', 'project-fixtures.js'), path.join(source, 'tools', 'runtime-paths.js'), __filename, require.resolve('./runtime-paths'), require.resolve('./dispatch-evidence')]);
}
function checkFrozen(config) { checkHashes(config.freeze); required(JSON.stringify(freezeInventory(resolveRuntimePaths({ root: config.runtime }), config.source, config.rulesRoot)) === JSON.stringify(config.freeze), 'Frozen input inventory changed'); }
function processIdentity() {
  const startedAt = process.platform === 'win32'
    ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${process.pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim()
    : new Date(Date.now() - process.uptime() * 1000).toISOString();
  return { pid: process.pid, processStartedAt: startedAt, acquiredAt: new Date().toISOString(), token: crypto.randomUUID() };
}
function acquire(root, identity = processIdentity) {
  const file = path.join(root, 'runner.lock.json');
  if (fs.existsSync(file)) throw new Error('INCOMPLETE: existing runner lock; explicit inspected recovery is required. Never auto-delete a stale lock.');
  const value = identity(); write(file, value); return { file, value };
}
function release(lock) { required(read(lock.file).token === lock.value.token, 'Runner lock identity changed'); fs.unlinkSync(lock.file); }
function subject(id, probeOnly = false) {
  const found = SUBJECTS.find(item => item.id === id) || (probeOnly && id === FABLE_DIAGNOSTIC.id ? FABLE_DIAGNOSTIC : null);
  required(found, 'Unknown subject, or diagnostic subject used for scored work'); return found;
}
function attemptId(opts, probeOnly = false) {
  const n = Number(opts.attempt ?? 1); required(Number.isSafeInteger(n) && n >= 1 && n <= 9999, 'attempt must be 1-9999');
  subject(opts.subject, probeOnly);
  if (!probeOnly) required(/^(software|writing|planning)-(s|m|l)$/.test(opts.task || ''), 'Unknown task');
  return `${opts.subject}-${probeOnly ? 'p' : opts.task[0] + opts.task.at(-1)}-a${n}`;
}

// Receipt schema: {schemaVersion:1,observations:[{id,bucketId,subjects:[{vendor,
// model,effort}],legacyBucketIds:[],observedAt,expiresAt,remainingPercent,
// included:true,paidUsageAuthorized:false,source:{kind,evidencePath,evidenceSha256}}]}.
// kind is vendor-native or owner-report; model reachability is not capacity.
function validateCapacity(receipt, legacy, pair, now = Date.now()) {
  required(receipt?.schemaVersion === 1 && Array.isArray(receipt.observations), 'Invalid capacity receipt');
  required(Array.isArray(legacy?.buckets), 'Legacy capacity ledger is missing buckets');
  required(legacy.buckets.every(row => typeof row?.bucketId === 'string' && ['unknown', 'available', 'exhausted'].includes(row.status)) && new Set(legacy.buckets.map(row => row.bucketId)).size === legacy.buckets.length, 'Legacy capacity buckets must be unique and valid');
  const matches = receipt.observations.filter(row => row?.subjects?.some(item => item.vendor === pair.vendor && item.model === pair.model && item.effort === pair.effort));
  required(matches.length === 1, 'Require exactly one capacity observation for the exact subject pair');
  const row = matches[0]; const observed = Date.parse(row.observedAt); const expiry = Date.parse(row.expiresAt);
  required(row.subjects.every(item => item?.vendor === pair.vendor && typeof item.model === 'string' && typeof item.effort === 'string'), 'Shared capacity subjects must name the same vendor');
  required(safeId(row.id) && typeof row.bucketId === 'string' && row.bucketId.length > 0, 'Capacity observation identity is missing');
  required(Number.isFinite(observed) && Number.isFinite(expiry) && observed <= now && expiry > now && expiry > observed && expiry - observed <= 1800000, 'Capacity observation is future, expired, or exceeds 30 minutes');
  required(row.included === true && row.paidUsageAuthorized === false && typeof row.remainingPercent === 'number' && Number.isFinite(row.remainingPercent) && row.remainingPercent > 0 && row.remainingPercent <= 100, 'Included positive capacity is not established');
  required(['vendor-native', 'owner-report'].includes(row.source?.kind) && path.isAbsolute(row.source?.evidencePath || '') && /^[a-f0-9]{64}$/.test(row.source?.evidenceSha256 || ''), 'Capacity needs admitted source evidence');
  assertPlainPath(row.source.evidencePath); required(hashFile(row.source.evidencePath) === row.source.evidenceSha256, 'Capacity source evidence changed');
  required(Array.isArray(row.legacyBucketIds) && new Set(row.legacyBucketIds).size === row.legacyBucketIds.length, 'Explicit unique legacyBucketIds are required');
  // Native agy /usage groups Flash and Pro under shared weekly and 5-hour limits.
  // Unknown Claude keys remain applicable until their independent scope is known.
  const separateClaude = new Set(['fable', 'opus', 'sonnet', 'haiku'].map(model => `claude/weekly-${model}`));
  const known = legacy.buckets.filter(item => pair.vendor === 'openai' ? item.bucketId.startsWith('codex/') : pair.vendor === 'anthropic'
    ? item.bucketId.startsWith('claude/') && (!separateClaude.has(item.bucketId) || item.bucketId === `claude/weekly-${pair.model}`)
    : item.bucketId.startsWith('gemini/'));
  required(known.every(item => row.legacyBucketIds.includes(item.bucketId)), 'Capacity mapping omits a known matching/shared legacy bucket');
  const prefix = pair.vendor === 'openai' ? 'codex/' : pair.vendor === 'anthropic' ? 'claude/' : 'gemini/';
  for (const id of row.legacyBucketIds) {
    const prior = legacy.buckets.find(item => item.bucketId === id);
    required(prior && id.startsWith(prefix), 'Unknown or cross-vendor legacy capacity mapping');
    if (prior.status === 'exhausted') required(Number.isFinite(Date.parse(prior.asOf)) && observed > Date.parse(prior.asOf), 'Known exhaustion requires a later admitted reading');
  }
  return row;
}

function briefText(template, id, pair, manifest) {
  const block = template.match(/```text\r?\n([\s\S]*?)\r?\n```/); required(block, 'Runtime brief template has no text block');
  const role = { software: 'implement', writing: 'research', planning: 'plan' }[manifest.domain];
  const vendor = { openai: 'codex', anthropic: 'claude', google: 'agy' }[pair.vendor];
  const rules = block[1].replace(/^SCOPE:.*$/m, `SCOPE: ${role === 'implement' ? 'Write only ' + manifest.writeScope.join(', ') + ' in the assigned product.' : 'Read-only. Do not modify any files or run product code.'}`)
    .replace(/^ROLE:.*$/m, `ROLE: ${role}. ${role === 'implement' ? 'Implement the bounded software task.' : 'Read-only role with empty writeScope.'}`)
    .replace(/^Vendor:.*$/m, `Vendor: ${vendor}; casper_via=agy for Google. hostMode: cursor-cli. not CONCLAVE.`);
  const readMethod = pair.vendor === 'anthropic' ? 'Use native Read calls only until all required instruction reads are complete; do not use Glob, Grep, Bash, or directory listings during those reads.' : 'Use the native file-read method permitted by the staged contract.';
  return `BRIEF ${id} ACK-${id}\n${rules}\nREAD ORDER: Independently read every required staged instruction before task work. ${readMethod} Use exact filenames from SEAT-CONTRACT.md, skills-manifest.json and RULES/INDEX.md. No leaf subdispatch and no vault writes.\nTASK: Read benchmark.json${role === 'implement' ? ' and CONTRACT.md' : ''} in the assigned cwd and complete its single task. ${role === 'implement' ? 'Use only the declared writeScope. Do not edit tests or git metadata.' : 'Return exactly one fenced json object as specified by benchmark.json. No product execution.'}\nFINAL: Begin with the exact first line of this brief. Then deliver the result${role === 'implement' ? ' and WRITE AUDIT' : ' in the single json fence'}. End with SCOPE: none, or name a scope blocker.\n`;
}

function initialize(opts) {
  for (const key of ['root', 'runtime', 'source', 'rulesRoot', 'legacyCapacity']) required(path.isAbsolute(opts[key] || ''), 'Absolute ' + key + ' required');
  const root = canonicalPlainPath(opts.root); const runtime = resolveRuntimePaths({ root: opts.runtime });
  const source = canonicalPlainPath(opts.source); const rulesRoot = canonicalPlainPath(opts.rulesRoot); const legacyCapacity = canonicalPlainPath(opts.legacyCapacity);
  required(!fs.existsSync(root), 'Experiment root must not exist');
  required(![runtime.root, source, rulesRoot].some(dir => pathsOverlap(root, dir)), 'Experiment root must be separate from runtime, source and rules');
  const fixtureModule = path.join(source, 'tools', 'benchmark-fixtures.js'); const fixtures = require(fixtureModule);
  const freeze = freezeInventory(runtime, source, rulesRoot);
  read(legacyCapacity);
  const config = { version: VERSION, benchmarkVersion: fixtures.BENCHMARK_VERSION, root, runtime: runtime.root, source, rulesRoot, legacyCapacity, freeze,
    subjects: SUBJECTS, diagnostics: [FABLE_DIAGNOSTIC], tasks: fixtures.BENCHMARK_CATALOG,
    coverage: SUBJECTS.flatMap(pair => fixtures.BENCHMARK_CATALOG.map(task => ({ subject: pair.id, taskId: task.taskId }))),
    concurrency: 1, automaticRetries: 0, hostClaim: 'Native subject experiment; actual host identity requires separate evidence. No MAGI product panel or activation.' };
  fs.mkdirSync(root); for (const dir of ['attempts', 'probes']) fs.mkdirSync(path.join(root, dir));
  boundWrite(path.join(root, 'experiment.json'), config); return { status: 'INITIALIZED', root, cells: config.coverage.length };
}
function loadConfig(root) {
  required(path.isAbsolute(root || ''), 'Absolute root required'); const config = boundRead(path.join(canonicalPlainPath(root), 'experiment.json'));
  required(config.version === VERSION && config.root === canonicalPlainPath(root), 'Experiment root or version mismatch'); return config;
}
function protectedWorkspace(manifest, initial = false) {
  for (const file of initial ? manifest.files : manifest.protectedHashes) required(hashFile(path.join(manifest.cwd, file.path)) === file.sha256, 'Frozen product file changed: ' + file.path);
}
function prepared(config, opts) {
  const id = attemptId(opts); const dir = path.join(config.root, 'attempts', id); const state = boundRead(path.join(dir, 'prepared.json'));
  checkHashes(state.bindings); required(state.subject === opts.subject && state.taskId === opts.task, 'Prepared attempt mismatch');
  return { ...state, dir, id, manifest: read(path.join(dir, 'fixture.json')), plan: read(path.join(dir, 'plan.json')) };
}
function contained(directory, file) { const relative = path.relative(canonicalPlainPath(directory), canonicalPlainPath(file)); return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); }
function transaction(state) { const tx = read(path.join(state.dir, 'run', '.magi-dispatches', transactionKey(state.plan.dispatches[0]) + '.json')); required(contained(path.join(state.dir, 'run'), tx.evidenceDir), 'Native evidence must remain inside its sealed run'); return tx; }
function currentJudgment(state, tx) { return fingerprint([...filesUnder(state.manifest.cwd).filter(file => !path.relative(state.manifest.cwd, file).split(path.sep).includes('.git')), path.join(tx.evidenceDir, 'capture.txt')]); }
function hostEnvironment(config, runtime) {
  const env = require(path.join(runtime.toolsDir, 'cli-adapters.js')).subscriptionEnv(process.env);
  for (const key of Object.keys(env)) if (['MAGI_VAULT_ROOT', 'NODE_OPTIONS'].includes(key.toUpperCase())) delete env[key];
  return Object.assign(env, { MAGI_ALLOWED_WORKSPACE_ROOTS: config.root, MAGI_RULES_ROOT: config.rulesRoot, AGY_CLI_DISABLE_AUTO_UPDATE: 'true' });
}
function nativeReplay(runtime, env, dependencies) {
  return dependencies.replay || ((options) => require(path.join(runtime.toolsDir, 'dispatch-run.js')).runDispatch(options, { env, runLaunch: async () => { throw new Error('NATIVE_RELAUNCH_FORBIDDEN'); } }));
}

async function runMode(mode, opts, dependencies = {}) {
  required(MODES.includes(mode), 'Unknown mode');
  if (mode === 'init') return initialize(opts);
  const config = loadConfig(opts.root);
  if (mode === 'status') {
    let frozen = true; try { checkFrozen(config); } catch { frozen = false; }
    const attempts = [];
    for (const id of fs.readdirSync(path.join(config.root, 'attempts')).sort()) {
      const dir = path.join(config.root, 'attempts', id);
      try {
        const p = boundRead(path.join(dir, 'prepared.json')); const completed = fs.existsSync(path.join(dir, 'completed.json')) ? boundRead(path.join(dir, 'completed.json')) : null;
        const judged = fs.existsSync(path.join(dir, 'objective.json')) ? boundRead(path.join(dir, 'objective.json')) : null;
        const attested = fs.existsSync(path.join(dir, 'attested.json')) ? boundRead(path.join(dir, 'attested.json')) : null;
        let objectiveCurrent = false;
        if (judged && frozen) { try {
          checkHashes(judged.binding);
          const state = prepared(config, { subject: p.subject, task: p.taskId, attempt: Number(id.match(/-a(\d+)$/)[1]) }); const tx = transaction(state);
          required(tx.status === 'PASS' && tx.receipt?.status === 'PASS', 'Native transaction proof is missing');
          const runtime = resolveRuntimePaths({ root: config.runtime });
          const proof = await nativeReplay(runtime, hostEnvironment(config, runtime), dependencies)({ plan: path.join(dir, 'run', 'dispatch-plan.json'), runDir: path.join(dir, 'run'), dispatchId: id, rulesRoot: config.rulesRoot });
          objectiveCurrent = proof.ok === true && proof.replayed === true && proof.receipt?.status === 'PASS' && JSON.stringify(currentJudgment(state, tx)) === JSON.stringify(judged.binding);
        } catch {} }
        attempts.push({ id, subject: p.subject, taskId: p.taskId, recordedNativeStatus: attested?.result?.ok === true ? 'PASS' : completed?.status || (fs.existsSync(path.join(dir, 'started.json')) ? 'INCOMPLETE' : 'PREPARED'), objectiveCurrent, deterministicPass: objectiveCurrent ? judged.result.deterministicPass : null, semanticStatus: 'NOT_EVALUATED' });
      } catch (error) { attempts.push({ id, recordedNativeStatus: 'INCOMPLETE', error: error.message }); }
    }
    return { frozen, lockPresent: fs.existsSync(path.join(config.root, 'runner.lock.json')), plannedCells: config.coverage.length, attempts };
  }
  checkFrozen(config);
  const lock = acquire(config.root, dependencies.identity); let safeToUnlock = true; let operationDir;
  const runtime = resolveRuntimePaths({ root: config.runtime });
  const env = hostEnvironment(config, runtime);
  async function command(dir, label, tool, args, maxWallMs = 120000, native = false) {
    checkFrozen(config);
    const frames = path.join(dir, 'frames'); fs.mkdirSync(frames, { recursive: true });
    const prefix = path.join(frames, label); const launch = { vendor: 'google', binary: tool === 'git' ? 'git' : process.execPath, args: tool === 'git' ? args : [path.join(runtime.toolsDir, tool + '.js'), ...args], cwd: tool === 'git' ? path.join(dir, 'product') : runtime.root, env, stdio: ['ignore', 'pipe', 'pipe'] };
    write(prefix + '.launch.json', { binary: launch.binary, args: launch.args, cwd: launch.cwd, startedAt: new Date().toISOString(), nativeBoundary: native });
    required(!fs.existsSync(prefix + '.pid'), 'Command PID evidence already exists');
    for (const suffix of ['.stdout.log', '.stderr.log']) fs.writeFileSync(prefix + suffix, '', { flag: 'wx' });
    safeToUnlock = false;
    try {
      const run = dependencies.command || require(path.join(runtime.toolsDir, 'cli-runner.js')).runLaunch;
      const result = await run(launch, { maxWallMs, idleCpuMs: maxWallMs, idleStdioMs: maxWallMs, pidFile: prefix + '.pid', stdoutFile: prefix + '.stdout.log', stderrFile: prefix + '.stderr.log', signal: dependencies.signal });
      write(prefix + '.result.json', { ...result, signal: result.signal ?? null, stdout: undefined, stderr: undefined, endedAt: new Date().toISOString() });
      required(result.exitConfirmed === true, 'INCOMPLETE: command exit is unconfirmed');
      if (native) {
        const confirm = dependencies.confirmStopped || require(path.join(runtime.toolsDir, 'dispatch-evidence.js')).assertInterruptedChildStopped;
        const processChecks = [confirm(result.pid, launch, dir, { label: 'wrapper', lifetime: result.lifetime })];
        const nativeDir = tool === 'model-probe' ? path.join(dir, 'native') : path.join(dir, 'run', 'evidence', read(path.join(dir, 'plan.json')).dispatches[0].dispatchId);
        // Discover the runtime-owned native launch through its transaction; do
        // not guess or kill a PID from an old completed capture.
        let actualDir = nativeDir; let nativeResultBinding;
        if (tool === 'dispatch-run') { const p = read(path.join(dir, 'plan.json')); const txFile = path.join(dir, 'run', '.magi-dispatches', transactionKey(p.dispatches[0]) + '.json'); if (fs.existsSync(txFile)) { const tx = read(txFile); actualDir = tx.evidenceDir; nativeResultBinding = tx.processResult; required(tx.scopeAudit?.incomplete !== true && tx.scopeAudit?.exitConfirmed !== false, 'INCOMPLETE: runtime reports uncertain native exit'); } }
        required(contained(dir, actualDir), 'Native evidence escaped its attempt');
        if (tool === 'model-probe' && fs.existsSync(path.join(actualDir, 'probe.json'))) { const probe = read(path.join(actualDir, 'probe.json')); nativeResultBinding = probe.processResult; required(probe.exitConfirmed !== false, 'INCOMPLETE: probe reports uncertain native exit'); }
        const childFile = path.join(actualDir, 'child.pid'); const launchFile = path.join(actualDir, 'launch.json');
        if (fs.existsSync(childFile)) {
          required(fs.existsSync(launchFile), 'INCOMPLETE: native launch identity is missing');
          const childPid = Number(fs.readFileSync(childFile, 'utf8').trim()); let lifetime;
          if (nativeResultBinding) {
            const file = path.join(actualDir, 'process-result.json');
            required(nativeResultBinding.path === file && hashFile(file) === nativeResultBinding.sha256, 'INCOMPLETE: native process result binding changed');
            const nativeResult = read(file);
            required(nativeResult.pid === childPid, 'INCOMPLETE: native process result PID changed');
            required(nativeResult.exitConfirmed === true, 'INCOMPLETE: native exit is unconfirmed');
            lifetime = nativeResult.lifetime;
          }
          processChecks.push(confirm(childPid, read(launchFile), actualDir, { label: 'native-child', lifetime }));
          write(prefix + '.process-checks.json', processChecks);
        }
        else throw new Error('INCOMPLETE: native command has no owned PID evidence; inspected recovery required');
      }
      safeToUnlock = true;
      required(result.ok === true && result.exitCode === 0, `${tool} failed; evidence retained at ${prefix}`);
      return tool === 'git' ? result.stdout.trim() : JSON.parse(result.stdout);
    } catch (error) { if (error.exitConfirmed === true && !native) safeToUnlock = true; throw error; }
  }
  async function admission(dir, pair) {
    const report = await command(dir, 'preflight', 'magi-cli-preflight', ['--rules-root', config.rulesRoot]); required(report.ok === true, 'MAGI preflight failed');
    required(path.isAbsolute(opts.capacity || ''), 'Absolute capacity receipt required');
    const receipt = read(opts.capacity); const legacy = read(config.legacyCapacity);
    write(path.join(dir, 'capacity-receipt.json'), receipt); write(path.join(dir, 'legacy-capacity.json'), legacy);
    const observed = validateCapacity(receipt, legacy, pair);
    write(path.join(dir, 'capacity-admission.json'), { observationId: observed.id, observedAt: observed.observedAt, checkedAt: new Date().toISOString(), receiptSha256: hashFile(opts.capacity), legacySha256: hashFile(config.legacyCapacity) });
    return () => { checkFrozen(config); required(hashFile(opts.capacity) === read(path.join(dir, 'capacity-admission.json')).receiptSha256 && hashFile(config.legacyCapacity) === read(path.join(dir, 'capacity-admission.json')).legacySha256, 'Capacity changed before native launch'); validateCapacity(receipt, legacy, pair); };
  }
  try {
    if (mode === 'prepare') {
      const id = attemptId(opts); const pair = subject(opts.subject); const dir = operationDir = path.join(config.root, 'attempts', id); fs.mkdirSync(dir);
      const fixture = require(path.join(config.source, 'tools', 'benchmark-fixtures.js')).generateBenchmark(opts.task, path.join(dir, 'product'));
      write(path.join(dir, 'fixture.json'), fixture);
      const template = fs.readFileSync(path.join(runtime.templatesDir, 'brief-rules-block.md'), 'utf8');
      fs.writeFileSync(path.join(dir, 'brief.md'), briefText(template, id, pair, fixture), { flag: 'wx' });
      const route = { dispatchId: id, unitId: id, class: 'benchmark-' + fixture.domain, role: { software: 'implement', writing: 'research', planning: 'plan' }[fixture.domain], vendor: pair.vendor, model: pair.model, effort: pair.effort, cwd: fixture.cwd, brief: path.join(dir, 'brief.md'), briefSha256: hashFile(path.join(dir, 'brief.md')), writeScope: fixture.writeScope, ...(pair.id === 'astra' ? { escalation: true, escalationReason: 'Owner requested exact Astra benchmark condition' } : {}) };
      const plan = { planId: id, purpose: 'benchmark', benchmark: { version: fixture.version, taskId: fixture.taskId, packetSha256: fixture.packetSha256 }, hostMode: 'cursor-cli', arbiter: { vendor: 'xai', model: 'grok-4.6', effort: 'high' }, magiConvened: false, dispatches: [route] };
      write(path.join(dir, 'plan.json'), plan);
      await command(dir, 'git-init', 'git', ['init']); await command(dir, 'git-add', 'git', ['add', '.']); await command(dir, 'git-commit', 'git', ['commit', '-m', 'Seed bounded domain benchmark fixture']);
      const gitHead = await command(dir, 'git-head', 'git', ['rev-parse', 'HEAD']);
      boundWrite(path.join(dir, 'prepared.json'), { id, subject: pair.id, taskId: fixture.taskId, gitHead, bindings: fingerprint(['fixture.json', 'brief.md', 'plan.json'].map(file => path.join(dir, file))) });
      return { status: 'PREPARED', id, dir };
    }
    if (mode === 'probe') {
      const pair = subject(opts.subject, true); const id = attemptId(opts, true); const dir = operationDir = path.join(config.root, 'probes', id); fs.mkdirSync(dir); fs.mkdirSync(path.join(dir, 'product'));
      const admit = await admission(dir, pair); admit(); write(path.join(dir, 'started.json'), { subject: pair, startedAt: new Date().toISOString() });
      const result = await command(dir, 'probe', 'model-probe', ['--vendor', pair.vendor, '--model', pair.model, '--effort', pair.effort, '--evidence-dir', path.join(dir, 'native'), '--cwd', path.join(dir, 'product')], 165000, true);
      required(result.status === 'PASS', 'Native probe did not pass');
      const availability = path.join(dir, 'availability.json');
      await command(dir, 'availability', 'model-availability', ['--file', availability, '--probe', path.join(dir, 'native', 'probe.json')]);
      boundWrite(path.join(dir, 'completed.json'), { status: 'PASS', subject: pair, availability, availabilitySha256: hashFile(availability), completedAt: new Date().toISOString(), diagnostic: pair.diagnostic === true });
      return { status: 'PASS', id, availability, diagnostic: pair.diagnostic === true };
    }
    const state = prepared(config, opts); operationDir = state.dir; const pair = subject(opts.subject); protectedWorkspace(state.manifest);
    const dispatchOptions = { plan: path.join(state.dir, 'run', 'dispatch-plan.json'), runDir: path.join(state.dir, 'run'), dispatchId: state.id, rulesRoot: config.rulesRoot };
    if (mode === 'run') {
      required(!fs.existsSync(path.join(state.dir, 'started.json')) && !fs.existsSync(path.join(state.dir, 'run')), 'Attempt already started or sealed; no automatic resume or rerun');
      protectedWorkspace(state.manifest, true);
      let availability = opts.availability;
      if (!availability) {
        const candidates = fs.readdirSync(path.join(config.root, 'probes')).map(id => path.join(config.root, 'probes', id, 'completed.json')).filter(file => fs.existsSync(file)).map(boundRead).filter(item => item.status === 'PASS' && item.subject.id === pair.id).sort((a, b) => a.completedAt.localeCompare(b.completedAt));
        const latest = candidates.at(-1); required(latest, 'No completed exact-pair probe; run probe first'); required(hashFile(latest.availability) === latest.availabilitySha256, 'Probe availability changed'); availability = latest.availability;
      }
      const admit = await admission(state.dir, pair);
      required(path.isAbsolute(availability || ''), 'Absolute availability path required');
      await command(state.dir, 'seal', 'plan-seal', ['--plan', path.join(state.dir, 'plan.json'), '--run-dir', dispatchOptions.runDir, '--availability', availability]);
      admit(); protectedWorkspace(state.manifest, true); checkHashes(state.bindings);
      write(path.join(state.dir, 'started.json'), { startedAt: new Date().toISOString(), subject: pair, maxWallMs: state.manifest.maxWallMs });
      const args = ['--plan', dispatchOptions.plan, '--run-dir', dispatchOptions.runDir, '--dispatch-id', state.id, '--rules-root', config.rulesRoot, '--max-wall-ms', String(state.manifest.maxWallMs)];
      const result = await command(state.dir, 'native-run', 'dispatch-run', args, state.manifest.maxWallMs + 45000, true);
      const status = result.ok === true && result.receipt?.status === 'PASS' ? 'PASS' : result.status === 'AWAITING_ATTESTATION' ? result.status : 'INCOMPLETE';
      required(status !== 'INCOMPLETE', 'Dispatch output has no accepted native status');
      boundWrite(path.join(state.dir, 'completed.json'), { status, result, completedAt: new Date().toISOString() }); return { status, id: state.id, result };
    }
    const tx = transaction(state);
    const replay = nativeReplay(runtime, env, dependencies);
    if (mode === 'attest') {
      required(pair.vendor === 'anthropic' && ['AWAITING_ATTESTATION', 'PASS'].includes(tx.status), 'Attestation requires an existing Claude checkpoint');
      required(/^[a-f0-9]{64}$/.test(opts.captureSha256 || '') && tx.receipt.captureSha256 === opts.captureSha256 && hashFile(path.join(tx.evidenceDir, 'capture.txt')) === opts.captureSha256, 'Inspected raw capture hash does not match');
      const result = await replay({ ...dispatchOptions, onTopic: true, captureSha256: opts.captureSha256 }); required(result.ok === true, 'Attestation failed');
      if (!fs.existsSync(path.join(state.dir, 'attested.json'))) boundWrite(path.join(state.dir, 'attested.json'), { captureSha256: opts.captureSha256, result, recordedAt: new Date().toISOString() });
      return { status: 'PASS', id: state.id, nativeCalls: 0 };
    }
    required(mode === 'judge' && tx.status === 'PASS', 'Judging requires committed native PASS');
    const proof = await replay(dispatchOptions); required(proof.ok === true && proof.replayed === true && proof.receipt?.status === 'PASS', 'Native proof replay did not pass');
    const binding = currentJudgment(state, tx); const objectivePath = path.join(state.dir, 'objective.json');
    if (fs.existsSync(objectivePath)) { const old = boundRead(objectivePath); checkHashes(old.binding); required(JSON.stringify(old.binding) === JSON.stringify(binding), 'Previous objective judgment is stale'); return { status: 'JUDGED', result: old.result, replayed: true, nativeCalls: 0 }; }
    const capture = fs.readFileSync(path.join(tx.evidenceDir, 'capture.txt'), 'utf8');
    const native = require(path.join(runtime.toolsDir, 'vendor-native.js'));
    const response = native.finalResponse(pair.vendor, capture, pair.vendor === 'anthropic' ? { responseProtocol: native.CLAUDE_RESPONSE_PROTOCOL } : {});
    const result = (dependencies.judge || require(path.join(config.source, 'tools', 'benchmark-fixtures.js')).judgeBenchmark)(opts.task, state.manifest.cwd, { manifest: state.manifest, response });
    const testRun = result.testRun;
    if (testRun && (testRun.timedOut || testRun.error || testRun.signal || !Number.isInteger(testRun.exitCode) || testRun.exitCode < 0)) {
      safeToUnlock = false;
      const reason = testRun.timedOut ? 'software judge timed out' : 'software judge terminated abnormally';
      write(path.join(state.dir, 'judge-incomplete.json'), { reason: reason + '; owned descendant exit is unconfirmed. Explicit recovery required.', result });
      throw new Error('INCOMPLETE: ' + reason + '; lock retained');
    }
    checkHashes(binding); boundWrite(objectivePath, { result, binding, nativeProofId: proof.proofId, judgedAt: new Date().toISOString(), semanticStatus: 'NOT_EVALUATED' });
    return { status: 'JUDGED', result, nativeCalls: 0 };
  } catch (error) {
    if (operationDir && fs.existsSync(operationDir)) write(path.join(operationDir, 'failure-' + crypto.randomUUID() + '.json'), { error: error.message, ...(error.processCheck ? { processCheck: error.processCheck } : {}), recordedAt: new Date().toISOString(), incomplete: !safeToUnlock });
    throw error;
  } finally { if (safeToUnlock) release(lock); }
}

function parseArgs(argv) {
  const [mode, ...rest] = argv; required(MODES.includes(mode), 'Mode must be ' + MODES.join('|'));
  const opts = {}; const allowed = ['root', 'runtime', 'source', 'rules-root', 'legacy-capacity', 'subject', 'task', 'attempt', 'capacity', 'availability', 'capture-sha256'];
  for (let i = 0; i < rest.length; i += 2) { const flag = rest[i]; required(flag?.startsWith('--') && allowed.includes(flag.slice(2)) && rest[i + 1] && !rest[i + 1].startsWith('--'), 'Unknown or incomplete option: ' + flag); const key = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); required(!Object.hasOwn(opts, key), 'Duplicate option: ' + flag); opts[key] = rest[i + 1]; }
  return { mode, opts };
}
async function main(argv = process.argv.slice(2), io = process) {
  const controller = new AbortController(); const cancel = () => controller.abort(); process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try { const { mode, opts } = parseArgs(argv); io.stdout.write(JSON.stringify(await runMode(mode, opts, { signal: controller.signal })) + '\n'); return 0; }
  catch (error) { io.stderr.write('BENCHMARK_RUN_FAIL: ' + error.message + '\n'); return 1; }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { VERSION, SUBJECTS, FABLE_DIAGNOSTIC, parseArgs, validateCapacity, briefText, runMode, main };
