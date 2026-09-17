// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { MAX_ATTEMPTS, classifyLaunchFailure, countToolCalls } = require('./launch-retry.js');
const { runDispatch } = require('./dispatch-run.js');
const { createSealedRun, fakeVendor } = require('./test-fixtures.js');

test('classifier retries only never-started signatures with zero tool calls under LAUNCH_FAIL', () => {
  const opus = "API Error: Opus 5's safeguards flagged this message (https://www.anthropic.com/legal/aup).";
  assert.equal(classifyLaunchFailure({ code: 'LAUNCH_FAIL', vendor: 'anthropic', stdout: `{"type":"result","is_error":true,"result":"${opus}"}` }).signature, 'safeguard-refusal');
  assert.equal(classifyLaunchFailure({ code: 'LAUNCH_FAIL', vendor: 'openai', stderr: 'ERROR: Reconnecting... waiting for network' }).signature, 'network-reconnect');
  assert.equal(classifyLaunchFailure({ code: 'LAUNCH_FAIL', vendor: 'google', stderr: 'You are not logged into Antigravity.' }).signature, 'auth-missing');
  // A seat that made a tool call ran; its failure is not a launch failure.
  const ran = classifyLaunchFailure({ code: 'LAUNCH_FAIL', vendor: 'anthropic', stdout: `{"type":"assistant","message":{"content":[{"type":"tool_use"}]}}\n${opus}` });
  assert.deepEqual([ran.retryable, ran.toolCalls], [false, 1]);
  assert.equal(classifyLaunchFailure({ code: 'PROOF_FAIL', vendor: 'anthropic', stdout: opus }).retryable, false);
  assert.equal(classifyLaunchFailure({ code: 'LAUNCH_FAIL', vendor: 'openai', stderr: 'exit=1 something else' }).retryable, false);
  assert.ok(countToolCalls('google', 'Print mode: soft-denying tool confirmation "RunCommand" at step 74') >= 1);
  assert.equal(MAX_ATTEMPTS, 3);
});

function failingOnce(vendor, stderr, times = 1) {
  const native = fakeVendor();
  const run = native.runLaunch;
  let failures = 0;
  native.runLaunch = async (launch) => {
    if (failures < times) { failures += 1; return { ok: false, exitCode: 1, stdout: '', stderr, exitConfirmed: true }; }
    return run(launch);
  };
  return native;
}

test('a classified launch failure keeps its evidence, marks the transaction RETRYABLE, and the same id re-runs to PASS', async t => {
  const run = createSealedRun(t, [{ vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium', role: 'implement', class: 'standard-feature' }]);
  const native = failingOnce('openai', 'ERROR: Reconnecting... waiting for network');
  const opts = { ...run.opts, dispatchId: run.dispatches[0].dispatchId };
  await assert.rejects(runDispatch(opts, native), (error) => error.code === 'LAUNCH_RETRYABLE' && error.attempt === 1 && error.signature === 'network-reconnect');
  const file = path.join(run.runDir, '.conclave-dispatches');
  const state = JSON.parse(fs.readFileSync(path.join(file, fs.readdirSync(file)[0]), 'utf8'));
  assert.equal(state.status, 'RETRYABLE');
  assert.equal(state.attempts.length, 1);
  assert.ok(fs.existsSync(state.attempts[0].evidenceDir) && state.attempts[0].evidenceDir.endsWith('.attempt1'));
  assert.equal(fs.existsSync(path.join(run.runDir, 'out', opts.dispatchId)), false);
  const result = await runDispatch(opts, native);
  assert.equal(result.receipt.status, 'PASS');
  const done = JSON.parse(fs.readFileSync(path.join(file, fs.readdirSync(file)[0]), 'utf8'));
  assert.deepEqual([done.status, done.attempts.length, done.attempts[0].signature], ['PASS', 1, 'network-reconnect']);
  const rows = fs.readFileSync(path.join(run.runDir, 'telemetry', 'dispatches.jsonl'), 'utf8').trim().split('\n');
  assert.equal(rows.length, 1, 'one telemetry row per logical dispatch (R17)');
});

test('an unclassified failure stays terminal and retries are capped at two', async t => {
  const run = createSealedRun(t, [{ vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium', role: 'implement', class: 'standard-feature' }]);
  const opts = { ...run.opts, dispatchId: run.dispatches[0].dispatchId };
  await assert.rejects(runDispatch(opts, failingOnce('openai', 'exit 1 for an unknown reason')), (error) => error.code === 'LAUNCH_FAIL');
  const file = path.join(run.runDir, '.conclave-dispatches');
  assert.equal(JSON.parse(fs.readFileSync(path.join(file, fs.readdirSync(file)[0]), 'utf8')).status, 'FAIL');
  await assert.rejects(runDispatch(opts, fakeVendor()), /use a new dispatch ID/);

  const run2 = createSealedRun(t, [{ vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium', role: 'implement', class: 'standard-feature' }]);
  const opts2 = { ...run2.opts, dispatchId: run2.dispatches[0].dispatchId };
  const always = failingOnce('openai', 'ERROR: Reconnecting... waiting for network', 99);
  await assert.rejects(runDispatch(opts2, always), (error) => error.code === 'LAUNCH_RETRYABLE' && error.attempt === 1);
  await assert.rejects(runDispatch(opts2, always), (error) => error.code === 'LAUNCH_RETRYABLE' && error.attempt === 2);
  await assert.rejects(runDispatch(opts2, always), (error) => error.code === 'LAUNCH_FAIL');
  const file2 = path.join(run2.runDir, '.conclave-dispatches');
  const final = JSON.parse(fs.readFileSync(path.join(file2, fs.readdirSync(file2)[0]), 'utf8'));
  assert.deepEqual([final.status, final.attempts.length], ['FAIL', 2]);
  await assert.rejects(runDispatch(opts2, always), /use a new dispatch ID/);
});

test('a run refuses a launch beyond principles.maxConcurrentDispatches while earlier seats are RUNNING', async t => {
  const run = createSealedRun(t, [{ vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium', role: 'implement', class: 'standard-feature' }]);
  const cap = require('./dispatch-matrix.js').loadMatrix().principles.maxConcurrentDispatches;
  assert.equal(cap, 3);
  const dir = path.join(run.runDir, '.conclave-dispatches'); fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < cap; i++) fs.writeFileSync(path.join(dir, `fake-running-${i}.json`), JSON.stringify({ status: 'RUNNING', startedAt: new Date().toISOString() }));
  const opts = { ...run.opts, dispatchId: run.dispatches[0].dispatchId };
  await assert.rejects(runDispatch(opts, fakeVendor()), /concurrent dispatch cap reached: 3 RUNNING of 3/);
  // A stale RUNNING row (older than the wall ceiling) does not count.
  fs.writeFileSync(path.join(dir, 'fake-running-0.json'), JSON.stringify({ status: 'RUNNING', startedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString() }));
  const result = await runDispatch(opts, fakeVendor());
  assert.equal(result.receipt.status, 'PASS');
});

test('a Google seat that attempted a tool (soft-denied in the native log) is never classified as never-started', () => {
  const nativeLog = 'I0916 ... tool_confirmation_manager.go:211] Print mode: soft-denying tool confirmation "ReplaceFileContent" at step 12\nYou are not logged into Antigravity.';
  const verdict = classifyLaunchFailure({ code: 'LAUNCH_FAIL', vendor: 'google', stderr: 'exit', nativeLog });
  assert.deepEqual([verdict.retryable, verdict.toolCalls > 0], [false, true]);
  assert.equal(classifyLaunchFailure({ code: 'LAUNCH_FAIL', vendor: 'google', stderr: 'You are not logged into Antigravity.' }).signature, 'auth-missing');
});
