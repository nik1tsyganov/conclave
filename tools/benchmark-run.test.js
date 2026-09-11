'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { runMode, parseArgs, validateCapacity, SUBJECTS } = require('./benchmark-run');
const { transactionKey } = require('./dispatch-evidence');
const source = path.resolve(__dirname, '..');
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function capacity(root, pair = SUBJECTS[0]) {
  const evidence = path.join(root, 'capacity-source.txt'); fs.writeFileSync(evidence, 'Fictional test-only included capacity observation');
  const now = Date.now();
  const legacy = { buckets: [{ bucketId: 'codex/gpt-5.6-sol', status: 'unknown', asOf: '2026-08-29' }, { bucketId: 'claude/weekly-opus', status: 'exhausted', asOf: '2026-08-29' }] };
  const receipt = { schemaVersion: 1, observations: [{ id: 'reading-1', bucketId: pair.vendor + '-included', subjects: [pair], legacyBucketIds: pair.vendor === 'openai' ? ['codex/gpt-5.6-sol'] : pair.model === 'opus' ? ['claude/weekly-opus'] : [], observedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 600000).toISOString(), remainingPercent: 50, included: true, paidUsageAuthorized: false, source: { kind: 'owner-report', evidencePath: evidence, evidenceSha256: hash(evidence) } }] };
  return { legacy, receipt };
}

async function setup(t, pair = SUBJECTS[0]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-runner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runtime = path.join(dir, 'runtime'); const rules = path.join(dir, 'rules');
  const tools = path.join(runtime, 'tools'); const references = path.join(runtime, 'skills', 'magi-cli', 'references');
  for (const folder of [tools, references, path.join(runtime, 'seat-skills'), path.join(tools, 'templates'), rules]) fs.mkdirSync(folder, { recursive: true });
  for (const name of ['dispatch-matrix.json', 'seat-profiles.json']) save(path.join(references, name), {});
  fs.copyFileSync(path.join(__dirname, 'templates', 'brief-rules-block.md'), path.join(tools, 'templates', 'brief-rules-block.md'));
  fs.writeFileSync(path.join(tools, 'cli-adapters.js'), 'module.exports = require(' + JSON.stringify(path.join(__dirname, 'cli-adapters.js')) + ');');
  fs.writeFileSync(path.join(tools, 'vendor-native.js'), 'module.exports = require(' + JSON.stringify(path.join(__dirname, 'vendor-native.js')) + ');');
  // Synthetic installed replay module lets status exercise its real default path.
  fs.writeFileSync(path.join(tools, 'dispatch-run.js'), `
const fs = require('node:fs'), path = require('node:path');
const { transactionKey } = require(${JSON.stringify(path.join(__dirname, 'dispatch-evidence.js'))});
exports.runDispatch = async options => {
  const plan = JSON.parse(fs.readFileSync(options.plan));
  const tx = JSON.parse(fs.readFileSync(path.join(options.runDir, '.magi-dispatches', transactionKey(plan.dispatches[0]) + '.json')));
  return { ok: tx.status === 'PASS' && tx.receipt?.status === 'PASS', replayed: true, receipt: tx.receipt };
};`);
  fs.writeFileSync(path.join(rules, 'STANDING.md'), 'Fake test-only rules');
  const c = capacity(dir, pair); const legacyCapacity = path.join(dir, 'legacy.json'); const capacityFile = path.join(dir, 'capacity.json');
  save(legacyCapacity, c.legacy); save(capacityFile, c.receipt);
  const root = path.join(dir, 'experiment');
  await runMode('init', { root, runtime, source, rulesRoot: rules, legacyCapacity });
  const calls = []; let pid = 900000;
  const dependencies = {
    identity: () => ({ pid: process.pid, processStartedAt: 'test-process-creation', token: 'test-lock', acquiredAt: new Date().toISOString() }),
    confirmStopped: () => ({ status: 'ABSENT', simulated: true }),
    async command(launch, options) {
      const tool = launch.binary === 'git' ? 'git' : path.basename(launch.args[0], '.js');
      const args = tool === 'git' ? launch.args : launch.args.slice(1);
      const get = flag => args[args.indexOf(flag) + 1]; calls.push({ tool, args, options, env: launch.env });
      const childPid = ++pid; fs.writeFileSync(options.pidFile, String(childPid));
      let result = {};
      if (tool === 'magi-cli-preflight') result = { ok: true, simulated: true };
      else if (tool === 'model-probe') {
        const native = get('--evidence-dir'); fs.mkdirSync(native); save(path.join(native, 'launch.json'), { binary: 'fake-vendor.exe' }); fs.writeFileSync(path.join(native, 'child.pid'), String(++pid));
        save(path.join(native, 'probe.json'), { fake: true }); result = { status: 'PASS' };
      } else if (tool === 'model-availability') { save(get('--file'), { simulated: true }); result = { available: true }; }
      else if (tool === 'plan-seal') {
        const run = get('--run-dir'); fs.mkdirSync(run); fs.copyFileSync(get('--plan'), path.join(run, 'dispatch-plan.json')); result = { planPath: path.join(run, 'dispatch-plan.json') };
      } else if (tool === 'dispatch-run') {
        const run = get('--run-dir'); const plan = JSON.parse(fs.readFileSync(get('--plan'), 'utf8')); const route = plan.dispatches[0];
        const evidence = path.join(run, 'native'); fs.mkdirSync(evidence); save(path.join(evidence, 'launch.json'), { binary: 'fake-vendor.exe' }); fs.writeFileSync(path.join(evidence, 'child.pid'), String(++pid));
        const capture = path.join(evidence, 'capture.txt'); const final = 'BRIEF simulated\n```json\n{}\n```';
        fs.writeFileSync(capture, route.vendor === 'anthropic' ? JSON.stringify({ type: 'result', subtype: 'success', session_id: 'fake-session', structured_output: { response: final } }) : final);
        const pending = route.vendor === 'anthropic';
        const receipt = { status: pending ? 'AWAITING_ATTESTATION' : 'PASS', captureSha256: hash(capture), proofId: 'fake-proof' };
        fs.mkdirSync(path.join(run, '.magi-dispatches'));
        save(path.join(run, '.magi-dispatches', transactionKey(route) + '.json'), { status: receipt.status, evidenceDir: evidence, receipt });
        result = pending ? { status: receipt.status, captureSha256: receipt.captureSha256 } : { ok: true, receipt, proofId: receipt.proofId };
      }
      const stdout = tool === 'git' ? 'fake-git-head\n' : JSON.stringify(result) + '\n';
      fs.appendFileSync(options.stdoutFile, stdout);
      return { ok: true, exitCode: 0, exitConfirmed: true, pid: childPid, stdout, stderr: '' };
    },
    async replay(options) {
      const plan = JSON.parse(fs.readFileSync(options.plan, 'utf8')); const txFile = path.join(options.runDir, '.magi-dispatches', transactionKey(plan.dispatches[0]) + '.json'); const tx = JSON.parse(fs.readFileSync(txFile, 'utf8'));
      if (options.onTopic) { assert.equal(options.captureSha256, tx.receipt.captureSha256); tx.status = tx.receipt.status = 'PASS'; save(txFile, tx); }
      return { ok: true, replayed: true, proofId: 'fake-proof', receipt: tx.receipt };
    },
    judge: () => ({ deterministicPass: true, semanticStatus: 'NOT_EVALUATED', qualityAccepted: null }),
  };
  return { root, dir, runtime, legacyCapacity, capacityFile, calls, dependencies, opts: { root, subject: pair.id, task: 'writing-s', capacity: capacityFile } };
}

test('init freezes exactly 99 primary cells and keeps Fable/high diagnostic separate', async t => {
  const s = await setup(t); const config = JSON.parse(fs.readFileSync(path.join(s.root, 'experiment.json'), 'utf8'));
  assert.equal(config.coverage.length, 99); assert.equal(new Set(config.coverage.map(row => row.subject + '/' + row.taskId)).size, 99);
  assert.equal(config.diagnostics[0].id, 'fableh'); assert.equal(config.coverage.some(row => row.subject === 'fableh'), false);
  await assert.rejects(runMode('prepare', { ...s.opts, subject: 'fableh' }, s.dependencies), /diagnostic/);
  assert.equal(s.calls.length, 0);
});

test('capacity rejects paid, stale, future, missing, wrong-pair, and forged evidence', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capacity-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { receipt, legacy } = capacity(root); const now = Date.now();
  assert.equal(validateCapacity(receipt, legacy, SUBJECTS[0]).id, 'reading-1');
  for (const mutate of [
    row => { row.included = false; }, row => { row.paidUsageAuthorized = true; }, row => { row.remainingPercent = 0; }, row => { row.remainingPercent = NaN; },
    row => { row.expiresAt = new Date(now - 1).toISOString(); }, row => { row.observedAt = new Date(now + 10000).toISOString(); }, row => { row.expiresAt = new Date(now + 1900000).toISOString(); },
    row => { row.subjects[0].effort = 'high'; }, row => { row.source.kind = 'model-probe'; }, row => { row.source.evidenceSha256 = '0'.repeat(64); }, row => { row.legacyBucketIds = []; },
  ]) { const bad = structuredClone(receipt); mutate(bad.observations[0]); assert.throws(() => validateCapacity(bad, legacy, SUBJECTS[0])); }
  const duplicate = structuredClone(receipt); duplicate.observations.push(structuredClone(duplicate.observations[0])); assert.throws(() => validateCapacity(duplicate, legacy, SUBJECTS[0]), /exactly one/);
  const exhausted = structuredClone(legacy); exhausted.buckets[0].status = 'exhausted'; exhausted.buckets[0].asOf = new Date(now).toISOString();
  assert.throws(() => validateCapacity(receipt, exhausted, SUBJECTS[0]), /later admitted/);
});

test('prepare uses canonical template, exact packet binding and exclusive attempts', async t => {
  const s = await setup(t); const prepared = await runMode('prepare', s.opts, s.dependencies);
  const plan = JSON.parse(fs.readFileSync(path.join(prepared.dir, 'plan.json'), 'utf8'));
  assert.equal(plan.purpose, 'benchmark'); assert.equal(plan.magiConvened, false); assert.equal(plan.benchmark.taskId, 'writing-s'); assert.deepEqual(plan.dispatches[0].writeScope, []);
  assert.equal(plan.benchmark.packetSha256, hash(path.join(prepared.dir, 'product', 'benchmark.json')));
  const brief = fs.readFileSync(path.join(prepared.dir, 'brief.md'), 'utf8'); assert.match(brief, /hostMode: cursor-cli/); assert.match(brief, /Read-only/); assert.match(brief, /native file-read/); assert.match(brief, /single json fence/);
  await assert.rejects(runMode('prepare', s.opts, s.dependencies), /exist/);
  assert.equal(s.calls.filter(call => call.tool === 'dispatch-run').length, 0);
});

test('Gemini shared capacity includes every legacy Gemini bucket and cannot erase newer exhaustion', async t => {
  const s = await setup(t, SUBJECTS.find(pair => pair.id === 'flashm'));
  const { receipt } = capacity(s.dir, SUBJECTS.find(pair => pair.id === 'flashm'));
  const row = receipt.observations[0]; const now = Date.now();
  const legacy = { buckets: [
    { bucketId: 'gemini/gemini-3.1-pro-high', status: 'exhausted', asOf: new Date(now).toISOString() },
    { bucketId: 'gemini/gemini-3.5-flash-low', status: 'unknown', asOf: '2026-08-29' },
  ] };
  const pair = SUBJECTS.find(item => item.id === 'flashm');
  assert.throws(() => validateCapacity(receipt, legacy, pair, now), /mapping/);
  row.legacyBucketIds = [legacy.buckets[0].bucketId];
  assert.throws(() => validateCapacity(receipt, legacy, pair, now), /mapping/);
  row.legacyBucketIds = legacy.buckets.map(item => item.bucketId);
  assert.throws(() => validateCapacity(receipt, legacy, pair, now), /later admitted/);
  row.observedAt = new Date(now + 1).toISOString();
  assert.equal(validateCapacity(receipt, legacy, pair, now + 2).id, 'reading-1');
});

test('Claude shared and ambiguous buckets cannot vanish while unrelated model buckets stay separate', async t => {
  const pair = SUBJECTS.find(item => item.id === 'fable'); const s = await setup(t, pair);
  const { receipt } = capacity(s.dir, pair); const row = receipt.observations[0]; const now = Date.now();
  const own = { bucketId: 'claude/weekly-fable', status: 'unknown', asOf: '2026-08-29' };
  row.legacyBucketIds = [own.bucketId];
  const unrelated = ['opus', 'sonnet', 'haiku'].map(model => ({ bucketId: `claude/weekly-${model}`, status: 'exhausted', asOf: new Date(now).toISOString() }));
  assert.equal(validateCapacity(receipt, { buckets: [own, ...unrelated] }, pair, now).id, 'reading-1');
  for (const bucketId of ['claude/weekly-all-models', 'claude/5-hour', 'claude/unclassified-window']) {
    const legacy = { buckets: [own, ...unrelated, { bucketId, status: 'exhausted', asOf: new Date(now).toISOString() }] };
    row.legacyBucketIds = [own.bucketId]; row.observedAt = new Date(now - 1000).toISOString();
    assert.throws(() => validateCapacity(receipt, legacy, pair, now), /mapping/);
    row.legacyBucketIds.push(bucketId);
    assert.throws(() => validateCapacity(receipt, legacy, pair, now), /later admitted/);
    row.observedAt = new Date(now + 1).toISOString();
    assert.equal(validateCapacity(receipt, legacy, pair, now + 2).id, 'reading-1');
    legacy.buckets.at(-1).status = 'unknown'; row.legacyBucketIds = [own.bucketId];
    assert.throws(() => validateCapacity(receipt, legacy, pair, now + 2), /mapping/);
  }
});

test('status replays proof and rejects missing sealed plan, receipt, and invalid replay without a launch', async t => {
  const s = await setup(t); const p = await runMode('prepare', s.opts, s.dependencies);
  await runMode('probe', s.opts, s.dependencies); await runMode('run', s.opts, s.dependencies); await runMode('judge', s.opts, s.dependencies);
  const before = s.calls.length;
  assert.equal((await runMode('status', { root: s.root })).attempts[0].objectiveCurrent, true);
  const planFile = path.join(p.dir, 'run', 'dispatch-plan.json'); const plan = fs.readFileSync(planFile);
  fs.unlinkSync(planFile);
  let status = await runMode('status', { root: s.root });
  assert.equal(status.attempts[0].objectiveCurrent, false); assert.equal(status.attempts[0].deterministicPass, null);
  fs.writeFileSync(planFile, plan);
  const txDir = path.join(p.dir, 'run', '.magi-dispatches'); const txFile = path.join(txDir, fs.readdirSync(txDir)[0]); const original = fs.readFileSync(txFile); const tx = JSON.parse(original);
  delete tx.receipt; save(txFile, tx);
  assert.equal((await runMode('status', { root: s.root })).attempts[0].objectiveCurrent, false);
  fs.writeFileSync(txFile, original);
  let replayCalls = 0;
  status = await runMode('status', { root: s.root }, { replay: async () => { replayCalls++; return { ok: false, replayed: true, receipt: { status: 'PASS' } }; } });
  assert.equal(status.attempts[0].objectiveCurrent, false); assert.equal(status.attempts[0].deterministicPass, null);
  assert.equal(replayCalls, 1); assert.equal(s.calls.length, before);
});

test('probe and run admit capacity separately, retain frames, and never rerun completed work', async t => {
  const s = await setup(t);
  await runMode('prepare', s.opts, s.dependencies);
  await runMode('probe', s.opts, s.dependencies);
  const run = await runMode('run', s.opts, s.dependencies); assert.equal(run.status, 'PASS');
  assert.equal(s.calls.filter(call => call.tool === 'magi-cli-preflight').length, 2);
  const native = s.calls.find(call => call.tool === 'dispatch-run'); assert.equal(native.args[native.args.indexOf('--max-wall-ms') + 1], '180000'); assert.equal(native.options.maxWallMs, 225000);
  assert.equal(native.env.AGY_CLI_DISABLE_AUTO_UPDATE, 'true'); assert.equal(native.env.MAGI_ALLOWED_WORKSPACE_ROOTS, s.root);
  const total = s.calls.length; await assert.rejects(runMode('run', s.opts, s.dependencies), /already started/); assert.equal(s.calls.length, total);
  const judged = await runMode('judge', s.opts, s.dependencies); assert.equal(judged.nativeCalls, 0); assert.equal(judged.result.qualityAccepted, null);
  assert.equal((await runMode('judge', s.opts, s.dependencies)).replayed, true); assert.equal(s.calls.length, total);
  const status = await runMode('status', { root: s.root }); assert.equal(status.attempts[0].objectiveCurrent, true);
});

test('stale capacity blocks a native call after preflight and preserves its rejection', async t => {
  const s = await setup(t); const receipt = JSON.parse(fs.readFileSync(s.capacityFile)); receipt.observations[0].remainingPercent = 0; save(s.capacityFile, receipt);
  await assert.rejects(runMode('probe', s.opts, s.dependencies), /positive capacity/);
  assert.equal(s.calls.filter(call => call.tool === 'model-probe').length, 0);
  assert.ok(fs.existsSync(path.join(s.root, 'probes', 'luna-p-a1', 'capacity-receipt.json')));
  assert.equal(fs.existsSync(path.join(s.root, 'runner.lock.json')), false);
});

test('existing and unconfirmed-child locks are retained without automatic recovery', async t => {
  const s = await setup(t); const file = path.join(s.root, 'runner.lock.json'); save(file, { pid: 999999, processStartedAt: 'old', token: 'old' });
  await assert.rejects(runMode('probe', s.opts, s.dependencies), /explicit inspected recovery/); assert.equal(s.calls.length, 0); assert.equal(JSON.parse(fs.readFileSync(file)).token, 'old'); fs.unlinkSync(file);
  const original = s.dependencies.command;
  s.dependencies.command = async (launch, options) => { const r = await original(launch, options); if (launch.args[0].endsWith('model-probe.js')) r.exitConfirmed = false; return r; };
  await assert.rejects(runMode('probe', s.opts, s.dependencies), /exit is unconfirmed/); assert.ok(fs.existsSync(file));
});

test('Claude attestation requires an inspected matching raw capture and never launches again', async t => {
  const s = await setup(t, SUBJECTS.find(pair => pair.id === 'opus'));
  await runMode('prepare', s.opts, s.dependencies); await runMode('probe', s.opts, s.dependencies);
  const run = await runMode('run', s.opts, s.dependencies); assert.equal(run.status, 'AWAITING_ATTESTATION');
  await assert.rejects(runMode('judge', s.opts, s.dependencies), /native PASS/);
  await assert.rejects(runMode('attest', { ...s.opts, captureSha256: '0'.repeat(64) }, s.dependencies), /Inspected raw capture/);
  const count = s.calls.length;
  assert.equal((await runMode('attest', { ...s.opts, captureSha256: run.result.captureSha256 }, s.dependencies)).nativeCalls, 0);
  assert.equal((await runMode('judge', s.opts, s.dependencies)).status, 'JUDGED'); assert.equal(s.calls.length, count);
  assert.equal((await runMode('status', { root: s.root })).attempts[0].recordedNativeStatus, 'PASS');
});

test('changed source, protected packet, and raw capture prevent stale judgments', async t => {
  const s = await setup(t); const p = await runMode('prepare', s.opts, s.dependencies); await runMode('probe', s.opts, s.dependencies); await runMode('run', s.opts, s.dependencies); await runMode('judge', s.opts, s.dependencies);
  const capture = path.join(p.dir, 'run', 'native', 'capture.txt'); fs.appendFileSync(capture, '\nchanged');
  await assert.rejects(runMode('judge', s.opts, s.dependencies), /Frozen file changed/);
  assert.equal((await runMode('status', { root: s.root })).attempts[0].objectiveCurrent, false);
  fs.appendFileSync(path.join(s.runtime, 'tools', 'cli-adapters.js'), '\n'); await assert.rejects(runMode('probe', { ...s.opts, attempt: 2 }, s.dependencies), /Frozen file changed/);
});

test('software judge timeout retains a persistent incomplete lock', async t => {
  const s = await setup(t); s.opts.task = 'software-s';
  await runMode('prepare', s.opts, s.dependencies); await runMode('probe', s.opts, s.dependencies); await runMode('run', s.opts, s.dependencies);
  s.dependencies.judge = () => ({ deterministicPass: false, testRun: { timedOut: true, pid: 999999 } });
  await assert.rejects(runMode('judge', s.opts, s.dependencies), /software judge timed out/);
  assert.ok(fs.existsSync(path.join(s.root, 'runner.lock.json')));
});

test('abnormal software judge launch/output termination retains evidence and lock', async t => {
  for (const testRun of [
    { pid: 999999, exitCode: null, signal: 'SIGTERM', error: 'spawnSync node.exe ENOBUFS', timedOut: false },
    { pid: 999999, exitCode: 0, signal: null, error: 'spawnSync node.exe EIO', timedOut: false },
    { pid: 999999, exitCode: 0, signal: 'SIGTERM', error: null, timedOut: false },
    { pid: 999999, exitCode: null, signal: null, error: null, timedOut: false },
  ]) {
    const s = await setup(t); s.opts.task = 'software-s';
    const p = await runMode('prepare', s.opts, s.dependencies);
    await runMode('probe', s.opts, s.dependencies); await runMode('run', s.opts, s.dependencies);
    s.dependencies.judge = () => ({ deterministicPass: false, testRun });
    await assert.rejects(runMode('judge', s.opts, s.dependencies), /INCOMPLETE.*terminated abnormally/);
    assert.ok(fs.existsSync(path.join(s.root, 'runner.lock.json')));
    assert.equal(fs.existsSync(path.join(p.dir, 'objective.json')), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(p.dir, 'judge-incomplete.json'))).result.testRun, testRun);
  }
});

test('ordinary software assertion failure records deterministic failure and unlocks', async t => {
  const s = await setup(t); s.opts.task = 'software-s';
  const p = await runMode('prepare', s.opts, s.dependencies);
  await runMode('probe', s.opts, s.dependencies); await runMode('run', s.opts, s.dependencies);
  s.dependencies.judge = () => ({ deterministicPass: false, testRun: { pid: 999999, exitCode: 1, signal: null, error: null, timedOut: false } });
  const result = await runMode('judge', s.opts, s.dependencies);
  assert.equal(result.status, 'JUDGED'); assert.equal(result.result.deterministicPass, false);
  assert.equal(fs.existsSync(path.join(s.root, 'runner.lock.json')), false);
  assert.ok(fs.existsSync(path.join(p.dir, 'objective.json')));
});

test('CLI rejects duplicate and unknown arguments without interpreting command text', () => {
  assert.throws(() => parseArgs(['run', '--root', '/a', '--root', '/b']), /Duplicate/);
  assert.throws(() => parseArgs(['run', '--shell', 'cmd']), /Unknown/);
  assert.equal(parseArgs(['run', '--root', '/a;no-shell']).opts.root, '/a;no-shell');
});

test('new frozen instruction files and extra product files invalidate prior conditions', async t => {
  const s = await setup(t); const p = await runMode('prepare', s.opts, s.dependencies); await runMode('probe', s.opts, s.dependencies); await runMode('run', s.opts, s.dependencies); await runMode('judge', s.opts, s.dependencies);
  fs.writeFileSync(path.join(p.dir, 'product', 'extra.txt'), 'added');
  assert.equal((await runMode('status', { root: s.root })).attempts[0].objectiveCurrent, false);
  await assert.rejects(runMode('judge', s.opts, s.dependencies), /stale/);
  fs.writeFileSync(path.join(s.runtime, 'seat-skills', 'new.md'), 'new');
  await assert.rejects(runMode('probe', { ...s.opts, attempt: 2 }, s.dependencies), /inventory changed/);
});

test('post-exit native descendant uncertainty retains the lock', async t => {
  const s = await setup(t); s.dependencies.confirmStopped = () => { throw new Error('descendant still live'); };
  await assert.rejects(runMode('probe', s.opts, s.dependencies), /descendant still live/);
  assert.ok(fs.existsSync(path.join(s.root, 'runner.lock.json')));
});

test('missing native PID evidence cannot unlock a failed native boundary', async t => {
  const s = await setup(t); const original = s.dependencies.command;
  s.dependencies.command = async (launch, options) => {
    const result = await original(launch, options);
    if (launch.args[0].endsWith('model-probe.js')) { const dir = launch.args[launch.args.indexOf('--evidence-dir') + 1]; fs.unlinkSync(path.join(dir, 'child.pid')); result.ok = false; result.exitCode = 1; }
    return result;
  };
  await assert.rejects(runMode('probe', s.opts, s.dependencies), /no owned PID evidence/);
  assert.ok(fs.existsSync(path.join(s.root, 'runner.lock.json')));
});
