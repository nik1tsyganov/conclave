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

for (const vendor of ['openai', 'anthropic']) test(`schema6 synthetic ${vendor} saved evidence verifies against its sealed profile`, async t => {
  // Deliberately synthesize a legacy profile, not an old native provider run.
  // Preserve captured instruction bytes; schema6 contracts could contain extra prose.
  const entry = vendor === 'anthropic' ? { vendor, model: 'sonnet', effort: 'medium' } : {};
  const run = createSealedRun(t, [entry]); const native = fakeVendor();
  await runDispatch({ ...run.opts, dispatchId: 'd1' }, native);
  const sealFile = path.join(run.runDir, 'plan-seal.json');
  const seal = JSON.parse(fs.readFileSync(sealFile, 'utf8'));
  const profiles = JSON.parse(seal.profilesText);
  profiles.schemaVersion = 6; delete profiles.operationalLessons;
  seal.profilesText = JSON.stringify(profiles);
  seal.profilesSha256 = require('./dispatch-evidence.js').hash(seal.profilesText);
  writeJson(sealFile, seal);
  const stateFile = path.join(run.runDir, '.magi-dispatches', transactionKey(run.dispatches[0]) + '.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const profileFile = path.join(state.evidenceDir, 'seat-profile.json');
  writeJson(profileFile, require('./seat-policy.js').buildSeatProfile(profiles, run.dispatches[0]));
  const launchFile = path.join(state.evidenceDir, 'launch.json');
  const launch = JSON.parse(fs.readFileSync(launchFile, 'utf8')); launch.seatProfileVersion = 6; writeJson(launchFile, launch);
  for (const item of state.artifacts) if ([sealFile, profileFile, launchFile].includes(item.path)) item.sha256 = hashFile(item.path);
  if (vendor === 'anthropic') {
    const checkpointFile = path.join(state.evidenceDir, 'checkpoint.json');
    const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
    for (const item of checkpoint.protectedInputs) if ([sealFile, profileFile, launchFile].includes(item.path)) item.sha256 = hashFile(item.path);
    writeJson(checkpointFile, checkpoint);
    state.artifacts.find(item => item.path === checkpointFile).sha256 = hashFile(checkpointFile);
  }
  writeJson(stateFile, state);
  const before = [sealFile, stateFile, profileFile, launchFile].map(hashFile);
  const sealed = require('./plan-seal.js').readSealedRun(run.runDir);
  const reader = require('./run-finalize.js');
  assert.equal(require('./seat-policy.js').loadProfiles().schemaVersion, 7);
  if (vendor === 'anthropic') reader.verifyCheckpoint(sealed, run.dispatches[0], state);
  else {
    reader.verifyExecution(sealed, run.dispatches[0], state);
    assert.equal((await runDispatch({ ...run.opts, dispatchId: 'd1' }, native)).replayed, true);
  }
  assert.equal(native.calls(), 1);
  assert.deepEqual([sealFile, stateFile, profileFile, launchFile].map(hashFile), before);
  fs.appendFileSync(profileFile, ' ');
  assert.throws(() => vendor === 'anthropic' ? reader.verifyCheckpoint(sealed, run.dispatches[0], state) : reader.verifyExecution(sealed, run.dispatches[0], state), /evidence changed/);
  seal.profilesText += ' '; writeJson(sealFile, seal);
  assert.throws(() => require('./plan-seal.js').readSealedRun(run.runDir), /policy snapshots changed/);
});
