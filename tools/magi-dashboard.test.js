'use strict';
// WRITE tests: all run/fixture mutations use disposable temporary directories.
// Native vendor calls are forbidden; the one runner integration uses fakeVendor.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');
const test = require('node:test');
const { LIMITS, createSnapshot, startServer, parseArgs } = require('./magi-dashboard.js');
const { createSealedRun, fakeVendor, temporary } = require('./test-fixtures.js');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
function fixture(t, entries = [{}]) {
  const root = temporary(t, 'magi-dashboard-');
  const runDir = path.join(root, 'run'); fs.mkdirSync(runDir);
  const dispatches = entries.map((entry, index) => ({ dispatchId: `d${index + 1}`, unitId: 'unit', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high', class: 'standard-feature', ...entry }));
  const plan = { planId: 'dashboard-fixture', hostMode: 'cursor-cli', dispatches };
  write(path.join(runDir, 'dispatch-plan.json'), plan);
  const seal = { schemaVersion: 2, planId: plan.planId, planHash: hash(fs.readFileSync(path.join(runDir, 'dispatch-plan.json'))), sealedAt: '2026-09-12T12:00:00.000Z' };
  write(path.join(runDir, 'plan-seal.json'), seal);
  function state(index = 0, status = 'RUNNING') {
    const entry = dispatches[index];
    const key = hash(JSON.stringify([entry.dispatchId, entry.unitId, entry.role]));
    const evidenceDir = path.join(runDir, 'out', entry.dispatchId);
    const value = { schemaVersion: 1, status, planId: plan.planId, planHash: seal.planHash, entry, requestHash: hash(JSON.stringify({ planHash: seal.planHash, entry })), evidenceDir, startedAt: '2026-09-12T12:01:00.000Z' };
    const file = path.join(runDir, '.magi-dispatches', `${key}.json`);
    write(file, value);
    return { file, value, key, evidenceDir };
  }
  return { root, runDir, plan, seal, dispatches, state };
}
function inventory(root, relative = '', result = {}) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) inventory(root, name, result);
    else result[name] = hash(fs.readFileSync(path.join(root, name)));
  }
  return result;
}
function request(dashboard, { route = '/api/snapshot', method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${dashboard.origin}${route}`, { method, headers: { Authorization: `Bearer ${dashboard.token}`, ...headers } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.end();
  });
}
async function serve(t, runDir) {
  const dashboard = await startServer({ runDir });
  t.after(async () => { dashboard.server.closeAllConnections(); await new Promise(resolve => dashboard.server.close(resolve)); });
  return dashboard;
}
function fakeWithClose() {
  const native = fakeVendor();
  return { ...native, runLaunch: async launch => {
    const startedAt = new Date().toISOString();
    const result = await native.runLaunch(launch);
    return { ...result, lifetime: { protocol: 'magi-process-lifetime-v1', startedAt, endedAt: new Date().toISOString(), exitConfirmed: true, exitEvidence: 'child-close-event' } };
  } };
}

test('real sealed fixture moves through native fake execution without observer writes or approval promotion', async t => {
  const run = createSealedRun(t);
  const beforeStart = inventory(run.runDir);
  const planned = createSnapshot(run.runDir);
  assert.equal(planned.dispatches[0].status, 'NOT_STARTED');
  assert.deepEqual(inventory(run.runDir), beforeStart);
  const result = await require('./dispatch-run.js').runDispatch({ ...run.opts, dispatchId: 'd1' }, fakeWithClose());
  assert.equal(result.ok, true);
  const beforeObserve = inventory(run.runDir);
  const completed = createSnapshot(run.runDir);
  assert.equal(completed.dispatches[0].status, 'PASS', JSON.stringify(completed.dispatches[0]));
  assert.equal(completed.dispatches[0].proofId, result.proofId);
  assert.equal(completed.run.approvalStatus, 'UNKNOWN');
  assert.equal(completed.dispatches[0].vote, null);
  assert.ok(completed.events.some(event => event.kind === 'child_close'));
  assert.deepEqual(inventory(run.runDir), beforeObserve);
  const entry = run.dispatches[0];
  write(path.join(run.runDir, 'run-summary.json'), { schemaVersion: 1, planId: run.sealed.planId, planHash: run.sealed.planHash, finalizedAt: new Date().toISOString(), executionStatus: 'PASS', approvalStatus: 'PASS', ok: true, units: [{ unitId: entry.unitId, status: 'PASS', reason: null }], outcomes: [{ ...entry, planId: run.sealed.planId, planHash: run.sealed.planHash, status: 'PASS' }] });
  const recorded = createSnapshot(run.runDir);
  assert.equal(recorded.run.approvalStatus, 'RECORDED_PASS');
  assert.equal(recorded.dispatches[0].vote, null);
  fs.rmSync(path.join(run.runDir, 'out', entry.dispatchId, 'proof.json'));
  const partial = createSnapshot(run.runDir);
  assert.equal(partial.dispatches[0].status, 'UNKNOWN');
  assert.equal(partial.run.approvalStatus, 'UNKNOWN');
});

test('genuine Claude checkpoint remains awaiting attestation with no approval or vote', async t => {
  const route = require('./dispatch-matrix.js').loadMatrix().classes['test-verification'].verify.find(row => row.vendor === 'anthropic');
  const run = createSealedRun(t, [{ ...route, role: 'verify', class: 'test-verification', authorVendor: 'openai' }]);
  const result = await require('./dispatch-run.js').runDispatch({ ...run.opts, dispatchId: 'd1' }, fakeWithClose());
  assert.equal(result.status, 'AWAITING_ATTESTATION');
  const frozen = inventory(run.runDir);
  const snapshot = createSnapshot(run.runDir);
  assert.equal(snapshot.dispatches[0].status, 'AWAITING_ATTESTATION');
  assert.equal(snapshot.dispatches[0].vote, null);
  assert.equal(snapshot.run.approvalStatus, 'UNKNOWN');
  assert.ok(snapshot.events.some(event => event.kind === 'checkpoint' && event.status === 'AWAITING_ATTESTATION'));
  assert.deepEqual(inventory(run.runDir), frozen);
});

test('Windows producer path spelling resolves to the same plain evidence directory', { skip: process.platform !== 'win32' }, async t => {
  const previous = { TEMP: process.env.TEMP, TMP: process.env.TMP };
  const alias = os.tmpdir().toLowerCase();
  let run;
  try {
    process.env.TEMP = alias; process.env.TMP = alias;
    run = createSealedRun(t);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
  const canonicalRun = fs.realpathSync.native(run.runDir);
  assert.notEqual(run.runDir, canonicalRun, 'The fixture must exercise a real path spelling difference');
  t.diagnostic(JSON.stringify({ producerRoot: run.runDir, canonicalRoot: canonicalRun }));
  const native = fakeWithClose();
  const runLaunch = async launch => {
    const snapshot = createSnapshot(run.runDir);
    assert.equal(snapshot.dispatches[0].status, 'RUNNING', snapshot.dispatches[0].issue);
    assert.ok(snapshot.events.some(event => event.kind === 'launch'));
    return native.runLaunch(launch);
  };
  const result = await require('./dispatch-run.js').runDispatch({ ...run.opts, dispatchId: 'd1' }, { ...native, runLaunch });
  assert.equal(result.ok, true);
  const frozen = inventory(run.runDir);
  const snapshot = createSnapshot(canonicalRun);
  assert.equal(snapshot.dispatches[0].status, 'PASS', snapshot.dispatches[0].issue);
  assert.equal(snapshot.dispatches[0].proofId, result.proofId);
  assert.deepEqual(inventory(run.runDir), frozen);
});

test('observed launch and bound prerequisite edges differ from planned role dependencies', t => {
  const run = fixture(t, [{}, { role: 'verify', vendor: 'google' }]);
  const original = run.state(1);
  write(path.join(original.evidenceDir, 'launch.json'), { planEntry: original.value.entry, planId: run.plan.planId, planHash: run.seal.planHash, startedAt: original.value.startedAt, prerequisites: [{ dispatchId: 'd1', proofId: 'a'.repeat(64), transactionSha256: 'b'.repeat(64) }] });
  const snapshot = createSnapshot(run.runDir, { nowMs: Date.parse('2026-09-12T12:02:00Z') });
  assert.equal(snapshot.run.executionStatus, 'RUNNING');
  assert.ok(snapshot.edges.some(edge => edge.from === 'd1' && edge.to === 'd2' && edge.kind === 'planned_dependency' && edge.observed === false));
  assert.ok(snapshot.edges.some(edge => edge.from === 'd1' && edge.to === 'd2' && edge.kind === 'prerequisite' && edge.observed === true));
  assert.ok(snapshot.edges.some(edge => edge.from === 'arbiter' && edge.to === 'd2' && edge.kind === 'dispatch'));
});

test('failed attempts preserve codes; finalized NOT_RUN never becomes an attempted failure', t => {
  const run = fixture(t, [{}, { role: 'verify' }]);
  const state = run.state(0, 'FAIL');
  Object.assign(state.value, { completedAt: '2026-09-12T12:02:00.000Z', code: 'NATIVE_TIMEOUT', error: 'secret raw output must not escape' });
  write(state.file, state.value);
  write(path.join(run.runDir, 'run-summary.json'), { schemaVersion: 1, planId: run.plan.planId, planHash: run.seal.planHash, finalizedAt: '2026-09-12T12:03:00.000Z', executionStatus: 'FAIL', approvalStatus: 'FAIL', ok: false, units: [{ unitId: 'unit', status: 'FAIL', reason: 'Missing independent verification' }], outcomes: run.dispatches.map((entry, index) => ({ ...entry, planId: run.plan.planId, planHash: run.seal.planHash, status: index ? 'NOT_RUN' : 'FAIL' })) });
  const snapshot = createSnapshot(run.runDir);
  assert.deepEqual(snapshot.dispatches.map(row => row.status), ['FAIL', 'NOT_RUN']);
  assert.equal(snapshot.dispatches[0].issue, 'NATIVE_TIMEOUT');
  assert.equal(snapshot.dispatches[1].attempts.length, 0);
  assert.equal(snapshot.run.approvalStatus, 'RECORDED_FAIL');
  assert.ok(!JSON.stringify(snapshot).includes('secret raw output'));
  const summaryFile = path.join(run.runDir, 'run-summary.json');
  const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
  for (const mutation of [{ approvalStatus: 'PASS' }, { executionStatus: 'PASS' }, { ok: true }]) {
    write(summaryFile, { ...summary, ...mutation });
    const inconsistent = createSnapshot(run.runDir);
    assert.equal(inconsistent.run.approvalStatus, 'UNKNOWN', JSON.stringify(mutation));
    assert.ok(inconsistent.run.warnings.some(warning => warning.includes('disagrees')));
  }
});

test('partial PASS, mismatched seal, and stale summary cannot produce a successful observation', t => {
  const run = fixture(t);
  const state = run.state(0, 'PASS');
  let snapshot = createSnapshot(run.runDir);
  assert.equal(snapshot.dispatches[0].status, 'UNKNOWN');
  assert.equal(snapshot.run.executionStatus, 'UNKNOWN');
  write(path.join(run.runDir, 'run-summary.json'), { schemaVersion: 1, planId: run.plan.planId, planHash: run.seal.planHash, approvalStatus: 'PASS', finalizedAt: '2026-09-12T12:00:00Z', outcomes: [] });
  snapshot = createSnapshot(run.runDir);
  assert.equal(snapshot.run.approvalStatus, 'UNKNOWN');
  assert.ok(snapshot.run.warnings.some(warning => warning.includes('stale')));
  write(path.join(run.runDir, 'plan-seal.json'), { ...run.seal, planHash: '0'.repeat(64) });
  write(state.file, { ...state.value, status: 'RUNNING' });
  assert.equal(createSnapshot(run.runDir).dispatches[0].status, 'UNKNOWN');
});

test('malformed, oversized and hard-linked metadata fail closed', t => {
  const run = fixture(t);
  const state = run.state();
  fs.writeFileSync(state.file, '{"status":');
  assert.throws(() => createSnapshot(run.runDir), /malformed or incomplete/);
  fs.writeFileSync(state.file, ' '.repeat(LIMITS.fileBytes + 1));
  assert.throws(() => createSnapshot(run.runDir), /read limit/);
  fs.rmSync(state.file); const linked = path.join(run.root, 'outside.json'); write(linked, state.value); fs.linkSync(linked, state.file);
  assert.throws(() => createSnapshot(run.runDir), /unsafe/);
});

test('untrusted evidence paths and junction roots cannot read outside the selected run', t => {
  const run = fixture(t);
  const state = run.state();
  const outside = path.join(run.root, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'launch.json'), 'secret and malformed');
  write(state.file, { ...state.value, evidenceDir: outside });
  const snapshot = createSnapshot(run.runDir);
  assert.equal(snapshot.dispatches[0].status, 'UNKNOWN');
  assert.equal(snapshot.dispatches[0].issue, 'UNTRUSTED_EVIDENCE_PATH');
  const link = path.join(run.root, 'linked-run');
  try { fs.symlinkSync(run.runDir, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.diagnostic('Symlink subcase NOT RUN: OS denies link creation.'); return; } throw error; }
  assert.throws(() => createSnapshot(link), /plain local directory/);
  fs.mkdirSync(path.dirname(state.evidenceDir), { recursive: true });
  fs.symlinkSync(outside, state.evidenceDir, process.platform === 'win32' ? 'junction' : 'dir');
  write(state.file, state.value);
  assert.equal(createSnapshot(run.runDir).dispatches[0].issue, 'UNTRUSTED_EVIDENCE_PATH');
});

test('network, device and traversal evidence paths are rejected before filesystem lookup', t => {
  const run = fixture(t); const state = run.state();
  const paths = ['//server/share/run/out/d1', String.raw`\\server\share\run\out\d1`, String.raw`\\?\C:\run\out\d1`, String.raw`\\.\PIPE\dashboard`, path.join(run.runDir, 'out') + '/../../outside'];
  const traversalTarget = path.resolve(paths.at(-1));
  const lookups = [];
  const original = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', function (file, ...args) {
    if (typeof file === 'string' && (/^[\\/]{2}/.test(file) || file === traversalTarget)) {
      lookups.push(file);
      throw new Error('Blocked unexpected external path lookup in test');
    }
    return original.call(fs, file, ...args);
  });
  for (const evidenceDir of paths) {
    write(state.file, { ...state.value, evidenceDir });
    const snapshot = createSnapshot(run.runDir);
    assert.equal(snapshot.dispatches[0].status, 'UNKNOWN');
    assert.equal(snapshot.dispatches[0].issue, 'UNTRUSTED_EVIDENCE_PATH');
  }
  assert.deepEqual(lookups, [], 'Untrusted network/device/traversal paths must not reach filesystem lookup');
});

test('runtime-generated recovery metadata stays separate and uses the production evidence directory', async t => {
  const { runDispatch } = require('./dispatch-run.js');
  const { recoveryPaths } = require('./dispatch-evidence.js');
  const { openaiLaunch } = require('./cli-adapters.js');
  const run = createSealedRun(t, [{ role: 'review', class: 'review-adversarial', model: 'gpt-5.6-sol', effort: 'high', authorVendor: 'google' }]);
  const interrupted = fakeVendor();
  interrupted.buildLaunch = opts => ({ ...opts, ...openaiLaunch({ ...opts, env: { ...interrupted.env, MAGI_CODEX_BIN: process.execPath } }) });
  const sessionId = crypto.randomUUID();
  const transcriptPath = path.join(run.root, 'interrupted-native.jsonl');
  fs.writeFileSync(transcriptPath, JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cwd: run.cwd } }) + '\n');
  let launched;
  const ready = new Promise(resolve => { launched = resolve; });
  interrupted.runLaunch = async (launch, options) => {
    fs.writeFileSync(options.pidFile, '123456789\n');
    fs.writeFileSync(options.stderrFile, `OpenAI Codex v0.153.4\nmodel: ${launch.model}\nsandbox: custom permissions\nreasoning effort: ${launch.effort}\nsession id: ${sessionId}\nuser\nPending task\n`);
    launched();
    // No child is spawned. An unresolved fake models host loss without a catch block.
    return new Promise(() => {});
  };
  void runDispatch({ ...run.opts, dispatchId: 'd1' }, interrupted).catch(launched);
  await ready;
  const dependencies = { ...fakeVendor(), assertInterruptedChildStopped: () => ({ pid: 123456789, status: 'ABSENT' }), codexSessionTranscript: () => ({ path: transcriptPath, text: fs.readFileSync(transcriptPath, 'utf8') }) };
  const requestPath = path.join(run.root, 'recovery-request.json');
  const options = { ...run.opts, dispatchId: 'd1', availability: run.availability };
  const prepared = await runDispatch({ ...options, prepareRecovery: requestPath }, dependencies);
  assert.equal(prepared.status, 'RECOVERY_PREPARED');
  const native = fakeWithClose();
  native.buildLaunch = opts => ({ ...opts, ...openaiLaunch({ ...opts, env: { ...native.env, MAGI_CODEX_BIN: process.execPath } }) });
  const result = await runDispatch({ ...options, recoverInterrupted: requestPath, recoverySha256: prepared.recoverySha256 }, { ...dependencies, ...native, assertInterruptedChildStopped: dependencies.assertInterruptedChildStopped });
  assert.equal(result.ok, true);
  const recovery = recoveryPaths(run.runDir, run.dispatches[0]);
  const recoveryState = JSON.parse(fs.readFileSync(recovery.transactionPath, 'utf8'));
  assert.equal(recoveryState.evidenceDir, path.join(recovery.attemptRoot, 'out', 'd1'));
  const frozen = inventory(run.runDir);
  const snapshot = createSnapshot(run.runDir);
  assert.equal(snapshot.dispatches[0].status, 'RUNNING');
  assert.deepEqual(snapshot.dispatches[0].attempts.map(attempt => attempt.status), ['RUNNING', 'PASS']);
  assert.equal(snapshot.dispatches[0].attempts[1].proofId, result.proofId);
  assert.ok(snapshot.events.some(event => event.id === 'd1:1:launch'));
  assert.ok(snapshot.events.some(event => event.id === 'd1:1:child_close'));
  assert.equal(snapshot.run.executionStatus, 'UNKNOWN');
  assert.equal(snapshot.run.approvalStatus, 'UNKNOWN');
  assert.equal(snapshot.dispatches[0].issue, 'RECOVERY_LINEAGE_UNVERIFIED');
  assert.deepEqual(inventory(run.runDir), frozen);
});

test('HTTP observer updates state and rejects missing capability, hostile hosts, origins, methods and path tricks', async t => {
  const run = fixture(t); const dashboard = await serve(t, run.runDir);
  assert.equal(dashboard.server.address().address, '127.0.0.1');
  assert.match(dashboard.url, /\/#token=[A-Za-z0-9_-]{43}$/);
  let result = await request(dashboard);
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.body).dispatches[0].status, 'NOT_STARTED');
  run.state();
  const frozen = inventory(run.runDir);
  result = await request(dashboard);
  assert.equal(JSON.parse(result.body).dispatches[0].status, 'RUNNING');
  assert.deepEqual(inventory(run.runDir), frozen);
  assert.equal(result.headers['access-control-allow-origin'], undefined);
  assert.match(result.headers['content-security-policy'], /frame-ancestors 'none'/);
  for (const [options, expected] of [
    [{ headers: { Authorization: '' } }, 401], [{ headers: { Authorization: 'Bearer wrong' } }, 401],
    [{ headers: { Host: 'localhost' } }, 403], [{ headers: { Origin: 'https://evil.example' } }, 403],
    [{ headers: { Origin: 'null' } }, 403], [{ headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403],
    [{ method: 'POST' }, 405], [{ method: 'OPTIONS' }, 405],
    [{ route: '/api/snapshot?token=' + dashboard.token }, 404], [{ route: '/dispatch-plan.json' }, 404],
    [{ route: '/%2e%2e/dispatch-plan.json' }, 404],
  ]) assert.equal((await request(dashboard, options)).status, expected, JSON.stringify(options));
  assert.equal((await request(dashboard, { headers: { Origin: dashboard.origin, 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
});

test('API read errors produce safe non-200 JSON, never a stale successful snapshot', async t => {
  const run = fixture(t); const dashboard = await serve(t, run.runDir);
  assert.equal((await request(dashboard)).status, 200);
  fs.writeFileSync(path.join(run.runDir, 'dispatch-plan.json'), '{');
  const result = await request(dashboard);
  assert.equal(result.status, 503);
  const body = JSON.parse(result.body);
  assert.deepEqual(Object.keys(body), ['error']);
  assert.ok(!result.body.includes(run.runDir));
  assert.ok(!result.body.includes('Error:'));
});

test('CLI requires an explicit run and rejects extra controls and invalid ports', () => {
  assert.deepEqual(parseArgs(['--run-dir', 'run']), { runDir: 'run', port: 0 });
  assert.deepEqual(parseArgs(['--port', '8040', '--run-dir', 'run']), { runDir: 'run', port: 8040 });
  for (const args of [[], ['--run-dir'], ['--run-dir', 'run', '--host', '0.0.0.0'], ['--run-dir', 'run', '--port', '-1'], ['--run-dir', 'run', '--port', '65536'], ['--run-dir', 'run', '--run-dir', 'elsewhere']]) assert.throws(() => parseArgs(args));
});
