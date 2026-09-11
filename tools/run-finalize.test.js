'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const { completeSyntheticDispatch, createSealedRun, fakeVendor } = require('./test-fixtures.js');
const { runDispatch } = require('./dispatch-run.js');
const { finalizeRun, inspectRun, tallyUnit } = require('./run-finalize.js');
const { openaiLaunch } = require('./cli-adapters.js');
const { hashFile, transactionKey, writeJson } = require('./dispatch-evidence.js');

async function scratchPanel(t, position = 'APPROVE') {
  const run = createSealedRun(t, [
    { unitId: 'u1', vendor: 'google', model: 'gemini-3.8-flash-medium', effort: 'fused-medium' },
    { unitId: 'u1', role: 'verify', class: 'test-verification', vendor: 'anthropic', model: 'sonnet', effort: 'medium', authorVendor: 'google' },
    { unitId: 'u1', role: 'review', class: 'review-adversarial', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'high', authorVendor: 'google' },
  ]);
  for (const row of run.dispatches) {
    const native = fakeVendor(() => {}, `ACK fixture\nPOSITION: ${row.role === 'review' ? position : 'APPROVE'}\nDone.`);
    if (row.vendor === 'openai') native.buildLaunch = opts => ({ ...opts, ...openaiLaunch({ ...opts, env: { ...native.env, MAGI_CODEX_BIN: process.execPath } }) });
    await completeSyntheticDispatch({ ...run.opts, dispatchId: row.dispatchId }, native);
  }
  return run;
}

test('bound OpenAI scratch review replays with exact native proof and approval', async t => {
  const run = await scratchPanel(t);
  const inspected = inspectRun(run.runDir);
  assert.deepEqual(inspected.outcomes.map(row => row.status), ['PASS', 'PASS', 'PASS']);
  assert.equal(inspected.executions[2].proof.sandbox, 'custom permissions');
  assert.equal(inspected.executions[2].proof.scratchPermissions.scratchPath, path.join(run.runDir, 'out/d3/scratch'));
  assert.equal(finalizeRun(run.runDir).ok, true);
});

test('bound scratch execution PASS does not turn an abstention into approval', async t => {
  const run = await scratchPanel(t, 'ABSTAIN');
  const result = finalizeRun(run.runDir);
  assert.equal(result.executionStatus, 'PASS');
  assert.equal(result.approvalStatus, 'FAIL');
  assert.equal(result.ok, false);
});

test('scratch replay rejects altered bound launch fields even with refreshed artifact hashes', async t => {
  const run = await scratchPanel(t);
  assert.equal(inspectRun(run.runDir).outcomes[2].status, 'PASS');
  const entry = run.dispatches[2];
  const stateFile = path.join(run.runDir, '.magi-dispatches', transactionKey(entry) + '.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const file = path.join(state.evidenceDir, 'launch.json');
  const original = fs.readFileSync(file, 'utf8');
  for (const mutate of [
    launch => { launch.model = 'gpt-5.6-terra'; },
    launch => { launch.effort = 'medium'; },
    launch => { launch.role = 'implement'; },
    launch => { launch.cwd = run.root; },
    launch => { launch.scratchPermissions.scratchPath = run.cwd; },
    launch => { launch.scratchEnv.TMP = run.cwd; },
    launch => { launch.args[launch.args.indexOf('-m') + 1] = 'gpt-5.6-terra'; },
    launch => { launch.args.push('--dangerously-bypass-approvals-and-sandbox'); },
    launch => { delete launch.scratchPermissions; },
  ]) {
    const changed = JSON.parse(original);
    mutate(changed); writeJson(file, changed);
    state.artifacts.find(item => item.path === file).sha256 = hashFile(file); writeJson(stateFile, state);
    const outcome = inspectRun(run.runDir).outcomes[2];
    assert.equal(outcome.status, 'INVALID', JSON.stringify(changed));
    assert.match(outcome.error, /scratch|launch/i);
  }
});

test('scratch replay rejects a directory alias created after the captured launch', async t => {
  const run = await scratchPanel(t);
  const scratch = path.join(run.runDir, 'out/d3/scratch');
  fs.rmdirSync(scratch);
  fs.symlinkSync(run.cwd, scratch, process.platform === 'win32' ? 'junction' : 'dir');
  const outcome = inspectRun(run.runDir).outcomes[2];
  assert.equal(outcome.status, 'INVALID');
  assert.match(outcome.error, /symlink|junction/);
});

function panelRun(t, options = {}) {
  return createSealedRun(t, [
    { unitId: 'u1', ...(options.author || {}) },
    { unitId: 'u1', role: 'verify', class: 'test-verification', vendor: 'anthropic', model: 'sonnet', effort: 'medium', authorVendor: 'openai' },
    { unitId: 'u1', role: 'review', class: 'review-adversarial', vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high', authorVendor: 'openai' },
  ], { magiConvened: true });
}
async function complete(run, reviewPosition = 'APPROVE') {
  for (const row of run.dispatches) await completeSyntheticDispatch({ ...run.opts, dispatchId: row.dispatchId }, fakeVendor(() => {}, `ACK fixture\nPOSITION: ${row.role === 'review' ? reviewPosition : 'APPROVE'}\nDone.`));
}

test('complete foreign verification and review approve once from native evidence', async (t) => {
  const run = panelRun(t);
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd2' }, fakeVendor()), /implementation must finish/);
  await complete(run);
  assert.equal(finalizeRun(run.runDir).ok, true);
  const first = fs.readFileSync(path.join(run.runDir, 'telemetry.jsonl'), 'utf8');
  assert.equal(finalizeRun(run.runDir).ok, true);
  assert.equal(fs.readFileSync(path.join(run.runDir, 'telemetry.jsonl'), 'utf8'), first);
  assert.equal(tallyUnit(inspectRun(run.runDir), 'u1').approveCount, 2);
});

test('execution success is distinct from a rejected review', async (t) => {
  const run = panelRun(t); await complete(run, 'REJECT');
  const result = finalizeRun(run.runDir);
  assert.equal(result.executionStatus, 'PASS'); assert.equal(result.approvalStatus, 'FAIL'); assert.equal(result.ok, false);
});

test('a rejecting verifier prevents review and approval', async (t) => {
  const run = panelRun(t);
  for (const row of run.dispatches.slice(0, 2)) await completeSyntheticDispatch({ ...run.opts, dispatchId: row.dispatchId }, fakeVendor(() => {}, `ACK fixture\nPOSITION: ${row.role === 'verify' ? 'REJECT' : 'APPROVE'}\nDone.`));
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd3' }, fakeVendor()), /verification did not approve/);
  const result = finalizeRun(run.runDir);
  assert.equal(result.executionStatus, 'FAIL'); assert.equal(result.approvalStatus, 'FAIL');
});

test('changed product files invalidate previous approval', async (t) => {
  const run = panelRun(t); await complete(run);
  fs.writeFileSync(path.join(run.cwd, 'late-edit.txt'), 'unreviewed');
  assert.equal(finalizeRun(run.runDir).approvalStatus, 'FAIL');
  assert.throws(() => tallyUnit(inspectRun(run.runDir), 'u1'), /worktree changed/);
});

test('missing and corrupt terminal evidence cannot activate', async (t) => {
  const run = panelRun(t);
  assert.equal(finalizeRun(run.runDir).outcomes.filter((row) => row.status === 'NOT_RUN').length, 3);
  await complete(run);
  fs.appendFileSync(path.join(run.runDir, 'out/d2/proof.json'), '\n');
  const result = finalizeRun(run.runDir);
  assert.equal(result.executionStatus, 'FAIL');
  assert.equal(result.outcomes[1].status, 'INVALID');
});

test('critical class requires independent planned vendors and two native votes', async (t) => {
  assert.throws(() => createSealedRun(t, [{ class: 'security-sensitive', model: 'gpt-5.6-sol', effort: 'xhigh' }]), /requires a panel/);
  const run = panelRun(t, { author: { class: 'security-sensitive', model: 'gpt-5.6-sol', effort: 'xhigh' } });
  await complete(run);
  assert.equal(finalizeRun(run.runDir).ok, true);
});

test('ballots cannot be supplied by the arbiter or inferred from prose', async (t) => {
  const run = panelRun(t);
  for (const row of run.dispatches.slice(0, 2)) await completeSyntheticDispatch({ ...run.opts, dispatchId: row.dispatchId }, fakeVendor(() => {}, 'ACK fixture\nThe arbiter says APPROVE.'));
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd3' }, fakeVendor()), /exactly one POSITION/);
  assert.equal(finalizeRun(run.runDir).approvalStatus, 'FAIL');
  assert.throws(() => tallyUnit(inspectRun(run.runDir), 'u1'), /exactly one POSITION/);
});
