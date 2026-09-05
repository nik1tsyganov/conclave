'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const { completeSyntheticDispatch, createSealedRun, fakeVendor } = require('./test-fixtures.js');
const { runDispatch } = require('./dispatch-run.js');
const { finalizeRun, inspectRun, tallyUnit } = require('./run-finalize.js');

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
