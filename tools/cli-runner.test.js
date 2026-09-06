'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { runLaunch } = require('./cli-runner.js');
const { temporary } = require('./test-fixtures.js');
const { spawn } = require('node:child_process');

function childFixture() {
  const child = new EventEmitter(); child.pid = 4123; child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  return child;
}
test('runner preserves buffered UTF-8, records one PID and waits for native exit', async (t) => {
  const root = temporary(t); const child = childFixture(); let spawnOptions;
  const result = runLaunch({ vendor: 'google', binary: 'fixture', args: [], cwd: root }, { spawn: (bin, args, opts) => { spawnOptions = opts; return child; }, pidFile: path.join(root, 'child.pid'), sampleCpuMs: () => null });
  const text = Buffer.from('結果'); child.stdout.emit('data', text.subarray(0, 2)); child.stdout.emit('data', text.subarray(2));
  child.emit('close', 0); const done = await result;
  assert.equal(done.stdout, '結果'); assert.equal(done.ok, true); assert.equal(done.exitConfirmed, true);
  assert.equal(fs.readFileSync(path.join(root, 'child.pid'), 'utf8').trim(), '4123');
  assert.equal(spawnOptions.shell, false); assert.equal(spawnOptions.windowsHide, true);
});
test('wall timeout kills only the recorded process and confirms its exit', async () => {
  const child = childFixture(); const killed = [];
  const result = await runLaunch({ vendor: 'google', binary: 'fixture', args: [] }, { spawn: () => child, pollMs: 5, maxWallMs: 10, sampleCpuMs: () => 100, kill: (pid) => { killed.push(pid); setImmediate(() => child.emit('close', 1)); } });
  assert.equal(result.ok, false); assert.equal(result.killed, true); assert.match(result.killReason, /wall/); assert.deepEqual(killed, [4123]);
});
test('cancellation cannot return success or start a pre-cancelled launch', async () => {
  const child = childFixture(); const controller = new AbortController(); const killed = [];
  const promise = runLaunch({ vendor: 'anthropic', binary: 'fixture', args: [] }, { spawn: () => child, signal: controller.signal, kill: (pid) => { killed.push(pid); setImmediate(() => child.emit('close', 0)); } });
  controller.abort(); const result = await promise;
  assert.equal(result.ok, false); assert.equal(result.killReason, 'cancelled'); assert.deepEqual(killed, [4123]);
  await assert.rejects(runLaunch({ binary: 'fixture', args: [] }, { signal: controller.signal, spawn: () => { throw new Error('must not spawn'); } }), { code: 'CANCELLED' });
});
test('nonzero exits, failed spawn and unconfirmed termination fail closed', async () => {
  const child = childFixture();
  const promise = runLaunch({ vendor: 'openai', binary: 'fixture', args: [] }, { spawn: () => child });
  child.emit('close', 7); assert.equal((await promise).ok, false);
  const bad = childFixture(); delete bad.pid;
  const missing = runLaunch({ vendor: 'openai', binary: 'absent', args: [] }, { spawn: () => bad });
  bad.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' })); await assert.rejects(missing, { code: 'ENOENT' });
  await assert.rejects(runLaunch({ vendor: 'google', binary: 'fixture', args: [] }, { spawn: childFixture, maxWallMs: 5, pollMs: 5, killGraceMs: 10, sampleCpuMs: () => 1, kill: () => {} }), { code: 'CHILD_EXIT_UNCONFIRMED' });
});
test('CPU-idle detection handles buffered output without a stdio-only kill', async () => {
  const child = childFixture();
  const result = await runLaunch({ vendor: 'anthropic', binary: 'fixture', args: [] }, { spawn: () => child, maxWallMs: 500, pollMs: 5, idleCpuMs: 10, idleStdioMs: 5, sampleCpuMs: () => 10, kill: () => setImmediate(() => child.emit('close', 1)) });
  assert.equal(result.killReason, 'idle-cpu');
});

test('PID persistence failure terminates its owned real Node child and waits for close', async t => {
  const root = temporary(t); let child; let closed = false;
  t.after(() => { if (child && !closed) child.kill('SIGKILL'); });
  let closePromise;
  await assert.rejects(runLaunch({ vendor: 'google', binary: process.execPath, args: ['-e', 'setTimeout(() => process.exit(0), 10000)'], cwd: root }, {
    spawn: (...args) => { child = spawn(...args); closePromise = new Promise(resolve => child.once('close', () => { closed = true; resolve(); })); return child; },
    kill: pid => { assert.equal(pid, child.pid); child.kill('SIGKILL'); },
    pidFile: path.join(root, 'missing-parent', 'child.pid'), killGraceMs: 5000,
  }), error => error.code === 'ENOENT' && error.exitConfirmed === true && error.pid === child.pid && closed);
  await closePromise; // The benign fixture expires itself even when termination is denied.
  assert.equal(closed, true);
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
});

test('output persistence errors wait for close or explicitly report unconfirmed exit', async t => {
  const root = temporary(t);
  for (const confirmsExit of [true, false]) {
    const child = childFixture(); let kills = 0; let closed = false;
    const result = runLaunch({ vendor: 'google', binary: 'fixture', args: [] }, {
      spawn: () => child, stdoutFile: root, sampleCpuMs: () => null, killGraceMs: 15,
      kill: () => { kills++; if (confirmsExit) setImmediate(() => { closed = true; child.emit('close', 1); }); },
    });
    child.stdout.emit('data', Buffer.from('output'));
    await assert.rejects(result, error => confirmsExit ? error.code === 'EISDIR' && error.exitConfirmed === true && closed : error.code === 'CHILD_EXIT_UNCONFIRMED' && error.exitConfirmed === false && error.pid === child.pid);
    assert.equal(kills, 1);
    if (!confirmsExit) child.emit('close', 1);
  }
});
