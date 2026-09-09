'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspectHooks, inspectJoinManifest, waitForDispatches, watch, writeJoinManifest } = require('./magi-synara-watch.js');

test('watchdog is silent when hooks allow and no leftover RUNNING pid', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-watch-clean-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hooks = path.join(root, 'hooks.json');
  fs.writeFileSync(hooks, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ decision: 'allow' }] }] } }), 'utf8');
  const runRoot = path.join(root, 'runs');
  fs.mkdirSync(path.join(runRoot, '.magi-dispatches'), { recursive: true });
  fs.writeFileSync(path.join(runRoot, '.magi-dispatches', 'ok.json'), JSON.stringify({ status: 'PASS', evidenceDir: path.join(runRoot, 'out', 'd1') }), 'utf8');
  const result = watch({ runRoots: [runRoot], hooks: [hooks] });
  assert.equal(result.notify, false);
  assert.deepEqual(result.findings, []);
});

test('watchdog notifies on RUNNING plus a dead pid and on ask hooks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-watch-dirty-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hooks = path.join(root, 'hooks.json');
  fs.writeFileSync(hooks, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ decision: 'ask' }] }] } }), 'utf8');
  const ask = inspectHooks(hooks);
  assert.equal(ask.kind, 'hooks-ask');

  const evidenceDir = path.join(root, 'out', 'd1');
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'child.pid'), '42424242\n', 'utf8');
  const txDir = path.join(root, 'attempt', '.magi-dispatches');
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

test('join waits for terminal MAGI transactions and never claims Synara wait', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-join-pass-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const txDir = path.join(root, '.magi-dispatches');
  fs.mkdirSync(txDir, { recursive: true });
  fs.writeFileSync(path.join(txDir, 'd1.json'), JSON.stringify({ status: 'PASS', evidenceDir: path.join(root, 'out', 'd1'), entry: { dispatchId: 'd1' } }), 'utf8');
  const result = waitForDispatches({ runDir: root, dispatchIds: ['d1'], timeoutMs: 200, pollMs: 20 });
  assert.equal(result.joined, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.notify, false);
  assert.equal(result.synaraWaitJoins, false);
  assert.equal(result.settled[0].dispatchId, 'd1');
});

test('join times out on a missing dispatch id', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-join-miss-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = waitForDispatches({ runDir: root, dispatchIds: ['d-missing'], timeoutMs: 40, pollMs: 10 });
  assert.equal(result.joined, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.notify, true);
  assert.equal(result.missing[0].dispatchId, 'd-missing');
});

test('join-manifest records MAGI ids and watchdog reports a join orphan', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-join-manifest-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const evidenceDir = path.join(root, 'out', 'd2');
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'child.pid'), '42424243\n', 'utf8');
  fs.mkdirSync(path.join(root, '.magi-dispatches'), { recursive: true });
  fs.writeFileSync(path.join(root, '.magi-dispatches', 'd2.json'), JSON.stringify({
    status: 'RUNNING',
    evidenceDir,
    entry: { dispatchId: 'd2' },
  }), 'utf8');
  const manifest = writeJoinManifest({ runDir: root, dispatchIds: ['d2'] });
  assert.equal(manifest.kind, 'magi-dispatch-join');
  assert.equal(manifest.synaraWaitJoins, false);
  assert.ok(fs.existsSync(path.join(root, 'join-manifest.json')));
  const findings = inspectJoinManifest(path.join(root, 'join-manifest.json'));
  assert.ok(findings.some((row) => row.kind === 'join-orphan' && row.dispatchId === 'd2'));
  const scanned = watch({ runRoots: [root], hooks: [] });
  assert.equal(scanned.notify, true);
  assert.ok(scanned.findings.some((row) => row.kind === 'join-orphan' || row.kind === 'dead-running'));
});
