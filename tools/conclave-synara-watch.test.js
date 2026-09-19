// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspectHooks, inspectJoinManifest, main, waitForDispatches, watch, writeJoinManifest } = require('./conclave-synara-watch.js');

test('watchdog is silent when hooks allow and no leftover RUNNING pid', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-watch-clean-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hooks = path.join(root, 'hooks.json');
  fs.writeFileSync(hooks, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ decision: 'allow' }] }] } }), 'utf8');
  const runRoot = path.join(root, 'runs');
  fs.mkdirSync(path.join(runRoot, '.conclave-dispatches'), { recursive: true });
  fs.writeFileSync(path.join(runRoot, '.conclave-dispatches', 'ok.json'), JSON.stringify({ status: 'PASS', evidenceDir: path.join(runRoot, 'out', 'd1') }), 'utf8');
  const result = watch({ runRoots: [runRoot], hooks: [hooks] });
  assert.equal(result.notify, false);
  assert.deepEqual(result.findings, []);
});

test('watchdog notifies on RUNNING plus a dead pid and on ask hooks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-watch-dirty-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hooks = path.join(root, 'hooks.json');
  fs.writeFileSync(hooks, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ decision: 'ask' }] }] } }), 'utf8');
  const ask = inspectHooks(hooks);
  assert.equal(ask.kind, 'hooks-ask');

  const evidenceDir = path.join(root, 'out', 'd1');
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'child.pid'), '42424242\n', 'utf8');
  const txDir = path.join(root, 'attempt', '.conclave-dispatches');
  fs.mkdirSync(txDir, { recursive: true });
  fs.writeFileSync(path.join(txDir, 'd1.json'), JSON.stringify({
    status: 'RUNNING',
    evidenceDir,
    entry: { dispatchId: 'd1' },
  }), 'utf8');
  const result = watch({ runRoots: [path.join(root, 'attempt')], hooks: [hooks] });
  assert.equal(result.notify, true);
  assert.ok(result.findings.some((row) => row.kind === 'dead-running' && row.dispatchId === 'd1'));
  assert.ok(result.findings.some((row) => row.kind === 'hooks-ask'));
});

test('join waits for terminal CONCLAVE transactions and never claims Synara wait', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-join-pass-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const txDir = path.join(root, '.conclave-dispatches');
  fs.mkdirSync(txDir, { recursive: true });
  fs.writeFileSync(path.join(txDir, 'd1.json'), JSON.stringify({ status: 'PASS', evidenceDir: path.join(root, 'out', 'd1'), entry: { dispatchId: 'd1' } }), 'utf8');
  const result = waitForDispatches({ runDir: root, dispatchIds: ['d1'], timeoutMs: 200, pollMs: 20 });
  assert.equal(result.joined, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.notify, false);
  assert.equal(result.synaraWaitJoins, false);
  assert.equal(result.settled[0].dispatchId, 'd1');
});

test('scan exit is fail-closed when leftovers exist and clean otherwise', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-watch-exit-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hooks = path.join(root, 'hooks.json');
  fs.writeFileSync(hooks, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ decision: 'allow' }] }] } }), 'utf8');
  const runRoot = path.join(root, 'runs');
  fs.mkdirSync(path.join(runRoot, '.conclave-dispatches'), { recursive: true });
  fs.writeFileSync(path.join(runRoot, '.conclave-dispatches', 'ok.json'), JSON.stringify({ status: 'PASS', evidenceDir: path.join(runRoot, 'out', 'd1') }), 'utf8');
  assert.equal(main(['--run-roots', runRoot, '--hooks', hooks]), 0);
  const evidenceDir = path.join(root, 'out', 'dead');
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'child.pid'), '42424244\n', 'utf8');
  fs.writeFileSync(path.join(runRoot, '.conclave-dispatches', 'dead.json'), JSON.stringify({
    status: 'RUNNING', evidenceDir, entry: { dispatchId: 'dead' },
  }), 'utf8');
  assert.equal(main(['--run-roots', runRoot, '--hooks', hooks]), 1);
});

test('wait without a dispatch id fails before treating an empty run as joined', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-join-empty-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => waitForDispatches({ runDir: root, dispatchIds: [], timeoutMs: 40, pollMs: 10 }), /--wait requires --dispatch-id/);
  assert.equal(main(['--wait', '--run-dir', root]), 2);
});

test('join times out on a missing dispatch id', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-join-miss-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = waitForDispatches({ runDir: root, dispatchIds: ['d-missing'], timeoutMs: 40, pollMs: 10 });
  assert.equal(result.joined, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.notify, true);
  assert.equal(result.missing[0].dispatchId, 'd-missing');
});

test('join-manifest records CONCLAVE ids and watchdog reports a join orphan', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-join-manifest-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const evidenceDir = path.join(root, 'out', 'd2');
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'child.pid'), '42424243\n', 'utf8');
  fs.mkdirSync(path.join(root, '.conclave-dispatches'), { recursive: true });
  fs.writeFileSync(path.join(root, '.conclave-dispatches', 'd2.json'), JSON.stringify({
    status: 'RUNNING',
    evidenceDir,
    entry: { dispatchId: 'd2' },
  }), 'utf8');
  const manifest = writeJoinManifest({ runDir: root, dispatchIds: ['d2'] });
  assert.equal(manifest.kind, 'conclave-dispatch-join');
  assert.equal(manifest.synaraWaitJoins, false);
  assert.ok(fs.existsSync(path.join(root, 'join-manifest.json')));
  const findings = inspectJoinManifest(path.join(root, 'join-manifest.json'));
  assert.ok(findings.some((row) => row.kind === 'join-orphan' && row.dispatchId === 'd2'));
  const scanned = watch({ runRoots: [root], hooks: [] });
  assert.equal(scanned.notify, true);
  // Both kinds are present in this fixture; an either/or matcher would pass if watch dropped one.
  assert.ok(scanned.findings.some((row) => row.kind === 'join-orphan' && row.dispatchId === 'd2'));
  assert.ok(scanned.findings.some((row) => row.kind === 'dead-running' && row.dispatchId === 'd2'));
});
