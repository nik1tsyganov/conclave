// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { runDispatch } = require('./dispatch-run.js');
const { assessRun, finalizeRun, inspectRun, verifyPrerequisites } = require('./run-finalize.js');
const { readSealedRun } = require('./plan-seal.js');
const { hashFile, snapshotWorkspace, transactionKey, writeJson } = require('./dispatch-evidence.js');
const { completeSyntheticDispatch, createSealedRun, fakeVendor } = require('./test-fixtures.js');

const verifier = { unitId: 'u1', role: 'verify', class: 'test-verification', vendor: 'anthropic', model: 'opus', effort: 'medium', authorVendor: 'openai' };
const reviewer = { unitId: 'u1', role: 'review', class: 'review-adversarial', vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high', authorVendor: 'openai' };
function panel(t, extra = []) { return createSealedRun(t, [{ unitId: 'u1' }, verifier, reviewer, ...extra]); }
function dispatch(run, id, native) { return completeSyntheticDispatch({ ...run.opts, dispatchId: id }, native); }
function transaction(run, id) {
  const entry = run.dispatches.find(row => row.dispatchId === id);
  const file = path.join(run.runDir, '.magi-dispatches', `${transactionKey(entry)}.json`);
  return { file, state: JSON.parse(fs.readFileSync(file, 'utf8')) };
}
function rewriteArtifact(run, id, name, change) {
  const { file, state } = transaction(run, id);
  const artifact = path.join(state.evidenceDir, name);
  fs.writeFileSync(artifact, change(fs.readFileSync(artifact, 'utf8')), 'utf8');
  for (const item of state.artifacts.filter(item => item.path === artifact)) item.sha256 = hashFile(artifact);
  writeJson(file, state);
}
async function complete(run, native) {
  for (const id of ['d1', 'd2', 'd3']) await dispatch(run, id, native);
}

test('review waits for every planned verifier without reserving a blocked dispatch', async t => {
  const run = panel(t, [{ ...verifier, dispatchId: 'extra-verifier' }]);
  const native = fakeVendor();
  await dispatch(run, 'd1', native);
  await assert.rejects(dispatch(run, 'd3', native), /verification.*finish|verifier.*finish/);
  assert.equal(native.calls(), 1);
  assert.equal(inspectRun(run.runDir).outcomes[2].status, 'NOT_RUN');
  await dispatch(run, 'd2', native);
  await assert.rejects(dispatch(run, 'd3', native), /verification.*finish|verifier.*finish/);
  assert.equal(native.calls(), 2);
  await dispatch(run, 'extra-verifier', native);
  await dispatch(run, 'd3', native);
  assert.equal(native.calls(), 4);
  assert.equal(finalizeRun(run.runDir).ok, true);
});

test('verification replays author native evidence after artifact digests are refreshed', async t => {
  const run = panel(t);
  const native = fakeVendor();
  await dispatch(run, 'd1', native);
  rewriteArtifact(run, 'd1', 'capture.txt', text => text.replace('ACK fixture', 'BAD fixture'));
  await assert.rejects(dispatch(run, 'd2', native), /wrong brief acknowledgement/);
  assert.equal(native.calls(), 1);
});

test('review cannot launch after a failed verification child', async t => {
  const run = panel(t);
  const native = fakeVendor();
  await dispatch(run, 'd1', native);
  const child = native.runLaunch;
  native.runLaunch = async launch => ({ ...await child(launch), ok: false, exitCode: 1 });
  await assert.rejects(dispatch(run, 'd2', native), /vendor child failed/);
  native.runLaunch = child;
  await assert.rejects(dispatch(run, 'd3', native), /verification.*finish|verifier.*finish/);
  assert.equal(native.calls(), 2);
});

test('review requires an explicit native APPROVE from each verifier', async t => {
  for (const response of ['ACK fixture\nPOSITION: REJECT', 'ACK fixture\nPOSITION: ABSTAIN', 'ACK fixture\nThe reviewer should approve.']) {
    const run = panel(t);
    const author = fakeVendor();
    await dispatch(run, 'd1', author);
    const check = fakeVendor(() => {}, response);
    await dispatch(run, 'd2', check);
    const review = fakeVendor();
    await assert.rejects(dispatch(run, 'd3', review), /did not approve|exactly one POSITION/);
    assert.equal(review.calls(), 0);
  }
});

test('review replays verifier payload instead of trusting a successful receipt', async t => {
  const run = panel(t);
  const native = fakeVendor();
  await dispatch(run, 'd1', native);
  await dispatch(run, 'd2', native);
  rewriteArtifact(run, 'd2', 'capture.txt', text => {
    const rows = text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const row = rows.find(item => item.type === 'result');
    delete row.structured_output;
    row.result = 'ACK fixture\nPOSITION: APPROVE';
    return rows.map(item => JSON.stringify(item)).join('\n');
  });
  await assert.rejects(dispatch(run, 'd3', native), /structured_output/);
  assert.equal(native.calls(), 2);
});

test('review rejects any workspace change after verification before starting a child', async t => {
  const run = panel(t);
  const native = fakeVendor();
  await dispatch(run, 'd1', native);
  await dispatch(run, 'd2', native);
  fs.writeFileSync(path.join(run.cwd, 'late.txt'), 'unverified', 'utf8');
  await assert.rejects(dispatch(run, 'd3', native), /worktree changed after verification/);
  assert.equal(native.calls(), 2);
});

test('verification binds the author scope while permitting other completed implementation units', async t => {
  const run = panel(t, [{ unitId: 'u2', vendor: 'anthropic', model: 'fable', effort: 'medium', writeScope: ['other.txt'] }]);
  const native = fakeVendor(launch => {
    if (launch.vendor === 'anthropic' && launch.role === 'implement') fs.writeFileSync(path.join(run.cwd, 'other.txt'), 'another unit', 'utf8');
  });
  await dispatch(run, 'd1', native);
  await dispatch(run, 'd4', native);
  await dispatch(run, 'd2', native);
  assert.equal(native.calls(), 3);
  const changed = panel(t);
  const child = fakeVendor();
  await dispatch(changed, 'd1', child);
  fs.writeFileSync(path.join(changed.cwd, 'result.txt'), 'replaced author work', 'utf8');
  await assert.rejects(dispatch(changed, 'd2', child), /implementation scope changed/);
  assert.equal(child.calls(), 1);
});

test('an implementation review requires a planned verifier', async t => {
  const run = createSealedRun(t, [{ unitId: 'u1' }, reviewer]);
  const native = fakeVendor();
  await dispatch(run, 'd1', native);
  await assert.rejects(dispatch(run, 'd2', native), /planned verifier|planned verification/);
  assert.equal(native.calls(), 1);
});

test('review-only panels retain independent launch order', async t => {
  const run = createSealedRun(t, [{ ...verifier, role: 'review', class: 'review-adversarial', model: 'opus', effort: 'high' }, reviewer]);
  const native = fakeVendor();
  await dispatch(run, 'd2', native);
  await dispatch(run, 'd1', native);
  assert.equal(native.calls(), 2);
  assert.equal(finalizeRun(run.runDir).ok, true);
});

test('completed replay uses historical sequence evidence without starting another child', async t => {
  const run = panel(t);
  const native = fakeVendor();
  await complete(run, native);
  const proof = transaction(run, 'd3').state.telemetry.proofId;
  fs.writeFileSync(path.join(run.cwd, 'later-unit.txt'), 'later work', 'utf8');
  const result = await dispatch(run, 'd3', native);
  assert.equal(result.replayed, true);
  assert.equal(result.proofId, proof);
  assert.equal(native.calls(), 3);
  assert.equal(finalizeRun(run.runDir).approvalStatus, 'FAIL');
});

test('finalization rejects review chronology that predates its verifier even after refreshed digests', async t => {
  const run = panel(t);
  const native = fakeVendor();
  await complete(run, native);
  const startedAt = new Date(Date.parse(transaction(run, 'd2').state.receipt.completedAt) - 1).toISOString();
  rewriteArtifact(run, 'd3', 'launch.json', text => JSON.stringify({ ...JSON.parse(text), startedAt }));
  const { file, state } = transaction(run, 'd3');
  state.startedAt = startedAt;
  writeJson(file, state);
  const inspected = inspectRun(run.runDir);
  assert.equal(inspected.outcomes[2].status, 'INVALID');
  assert.match(inspected.outcomes[2].error, /sequence|before.*completed|before.*finish/);
  await assert.rejects(dispatch(run, 'd3', native), /sequence|before.*completed|before.*finish/);
  assert.equal(native.calls(), 3);
});

test('prerequisite commits may follow receipts but must precede the child start', async t => {
  const run = panel(t);
  const native = fakeVendor();
  await dispatch(run, 'd1', native);
  const { file, state } = transaction(run, 'd1');
  const completed = Date.parse(state.receipt.completedAt);
  state.completedAt = new Date(completed + 10).toISOString();
  writeJson(file, state);
  const sealed = readSealedRun(run.runDir);
  const before = snapshotWorkspace(run.cwd);
  const entry = sealed.plan.dispatches.find(row => row.dispatchId === 'd2');
  const prerequisites = verifyPrerequisites(sealed, entry, before, new Date(completed + 20).toISOString());
  assert.deepEqual(prerequisites, [{ dispatchId: 'd1', proofId: state.receipt.proofId, transactionSha256: hashFile(file) }]);
  assert.throws(() => verifyPrerequisites(sealed, entry, before, new Date(completed + 5).toISOString()), /sequence starts before prerequisite completed/);
  assert.equal(native.calls(), 1);
});

test('finalization permits a later commit timestamp and rejects commits preceding the receipt', async t => {
  const run = panel(t);
  const native = fakeVendor();
  await complete(run, native);
  const { file, state } = transaction(run, 'd3');
  const completed = Date.parse(state.receipt.completedAt);
  state.completedAt = new Date(completed + 10).toISOString();
  writeJson(file, state);
  assert.equal(finalizeRun(run.runDir).ok, true);
  assert.equal((await dispatch(run, 'd3', native)).replayed, true);
  state.completedAt = new Date(completed - 1).toISOString();
  writeJson(file, state);
  assert.equal(inspectRun(run.runDir).outcomes[2].status, 'INVALID');
  await assert.rejects(dispatch(run, 'd3', native), /sequence timestamps/);
  assert.equal(native.calls(), 3);
});

test('missing or downgraded sequence metadata cannot turn new work into a legacy replay', async t => {
  for (const sequenceProtocol of [undefined, 'legacy']) {
    const run = panel(t);
    const native = fakeVendor();
    await complete(run, native);
    rewriteArtifact(run, 'd3', 'launch.json', text => JSON.stringify({ ...JSON.parse(text), sequenceProtocol }));
    assert.equal(inspectRun(run.runDir).outcomes[2].status, 'INVALID');
    await assert.rejects(dispatch(run, 'd3', native), /sequence protocol/);
    assert.equal(native.calls(), 3);
  }
});

test('refreshed artifact hashes cannot replace the prerequisite transaction bindings', async t => {
  const run = panel(t);
  const native = fakeVendor();
  await complete(run, native);
  rewriteArtifact(run, 'd3', 'launch.json', text => {
    const launch = JSON.parse(text);
    launch.prerequisites[1].transactionSha256 = '0'.repeat(64);
    return JSON.stringify(launch);
  });
  const inspected = inspectRun(run.runDir);
  assert.equal(inspected.outcomes[2].status, 'INVALID');
  assert.match(inspected.outcomes[2].error, /sequence prerequisites/);
  await assert.rejects(dispatch(run, 'd3', native), /sequence prerequisites/);
  assert.equal(native.calls(), 3);
});

test('assessment reads authoritative outcomes without writing projections', async t => {
  const run = panel(t);
  await complete(run, fakeVendor());
  const before = snapshotWorkspace(run.runDir);
  const assessed = assessRun(inspectRun(run.runDir));
  assert.equal(assessed.ok, true);
  assert.deepEqual(snapshotWorkspace(run.runDir), before);
  const final = finalizeRun(run.runDir);
  // finalize adds the completion rows (units, run) on top of the assessment; the assessment itself is unchanged.
  const { unitRows, runRow, ...finalCore } = final;
  assert.ok(Array.isArray(unitRows) && runRow && runRow.kind === 'run');
  assert.deepEqual({ ...finalCore, finalizedAt: null }, { ...assessed, finalizedAt: null });
});
