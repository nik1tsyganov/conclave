'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspectHooks, watch } = require('./magi-synara-watch.js');

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
