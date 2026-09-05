'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseArgs, runDispatch } = require('./dispatch-run.js');
const { finalizeRun, inspectRun } = require('./run-finalize.js');
const { hashFile, snapshotWorkspace, transactionKey, writeJson } = require('./dispatch-evidence.js');
const { verifyProof } = require('./cli-proof.js');
const { createReport } = require('./project-run-report.js');
const { createSealedRun, fakeVendor } = require('./test-fixtures.js');

function claudeRun(t) {
  return createSealedRun(t, [{ vendor: 'anthropic', model: 'sonnet', effort: 'medium' }]);
}
function command(run, extra = []) {
  return parseArgs(['--plan', run.opts.plan, '--run-dir', run.runDir, '--dispatch-id', 'd1',
    '--rules-root', run.opts.rulesRoot, '--skill-source-root', run.opts.skillSourceRoot, ...extra]);
}
function saved(run, id = 'd1') {
  const entry = run.dispatches.find(row => row.dispatchId === id);
  const file = path.join(run.runDir, '.magi-dispatches', `${transactionKey(entry)}.json`);
  return { file, state: JSON.parse(fs.readFileSync(file, 'utf8')) };
}
function accept(run, result, native) {
  return runDispatch(command(run, ['--on-topic', '--capture-sha256', result.captureSha256]), native);
}
function rewriteArtifact(run, name, change) {
  const { file, state } = saved(run);
  const artifact = path.join(state.evidenceDir, name);
  fs.writeFileSync(artifact, change(fs.readFileSync(artifact, 'utf8')), 'utf8');
  state.artifacts.find(item => item.path === artifact).sha256 = hashFile(artifact);
  writeJson(file, state);
}

// Synthetic native transport; no vendor binary or paid model is invoked.
test('documented Claude launch creates a non-approving checkpoint without pre-attestation', async t => {
  const run = claudeRun(t);
  const native = fakeVendor();
  const result = await runDispatch(command(run), native);
  assert.equal(result.status, 'AWAITING_ATTESTATION');
  assert.equal(result.ok, false);
  assert.equal(native.calls(), 1);
  assert.equal(inspectRun(run.runDir).outcomes[0].status, 'AWAITING_ATTESTATION');
  assert.equal(fs.existsSync(path.join(run.runDir, 'telemetry', 'dispatches.jsonl')), false);
  const summary = finalizeRun(run.runDir);
  assert.equal(summary.ok, false);
  assert.equal(summary.executionStatus, 'FAIL');
  assert.notEqual(summary.approvalStatus, 'PASS');
  const reported = createReport({ runDir: run.runDir, outputDir: path.join(run.root, 'pending-report') }).report;
  assert.equal(reported.dispatches[0].status, 'AWAITING_ATTESTATION');
  assert.match(reported.issues[0].message, /post-run inspection/);
  assert.equal(reported.dispatches[0].evidenceDir, path.dirname(result.capturePath));
});

test('pending reads and duplicate acceptance never repeat the synthetic child', async t => {
  const run = claudeRun(t);
  const native = fakeVendor();
  const pending = await runDispatch(command(run), native);
  const before = snapshotWorkspace(run.runDir);
  const reread = await runDispatch(command(run), native);
  assert.deepEqual(reread, { ...pending, replayed: true });
  assert.deepEqual(snapshotWorkspace(run.runDir), before);
  assert.equal(pending.captureSha256, hashFile(pending.capturePath));
  assert.equal(fs.readFileSync(pending.responsePath, 'utf8'), 'ACK fixture\nPOSITION: APPROVE\nDone.');
  const nativeCompletedAt = saved(run).state.receipt.completedAt;
  const results = await Promise.all([accept(run, pending, native), accept(run, pending, native)]);
  assert.equal(results.every(result => result.ok), true);
  assert.equal(results[1].replayed, true);
  assert.equal(results[0].proofId, pending.proofId);
  assert.equal(results[0].receipt.completedAt, nativeCompletedAt);
  assert.equal(pending.captureSha256, hashFile(pending.capturePath));
  assert.equal(native.calls(), 1);
  const execution = inspectRun(run.runDir).executions[0];
  assert.equal(Object.hasOwn(execution.proof, 'onTopic'), false);
  assert.equal(finalizeRun(run.runDir).executionStatus, 'PASS');
  const rows = fs.readFileSync(path.join(run.runDir, 'telemetry', 'dispatches.jsonl'), 'utf8').trim().split('\n');
  assert.equal(rows.length, 1);
  assert.throws(() => verifyProof({ vendor: 'anthropic', capture: pending.capturePath, log: path.join(path.dirname(pending.capturePath), 'vendor.log'), expectedModel: 'sonnet', expectedObservedModel: 'claude-sonnet-5', expectedEffort: 'medium' }), /topicality/);
});

test('premature or incomplete attestation flags cannot start a child or change a sealed run', async t => {
  for (const extra of [['--on-topic'], ['--capture-sha256', '0'.repeat(64)], ['--on-topic', '--capture-sha256', 'bad'], ['--on-topic', '--capture-sha256', '0'.repeat(64)]]) {
    const run = claudeRun(t);
    const native = fakeVendor();
    const before = snapshotWorkspace(run.runDir);
    await assert.rejects(runDispatch(command(run, extra), native), /attestation|SHA-256/);
    assert.equal(native.calls(), 0);
    assert.deepEqual(snapshotWorkspace(run.runDir), before);
  }
});

test('missing malformed and mismatched checkpoint hashes leave pending evidence unchanged', async t => {
  const run = claudeRun(t);
  const native = fakeVendor();
  const pending = await runDispatch(command(run), native);
  for (const extra of [['--on-topic'], ['--capture-sha256', pending.captureSha256], ['--on-topic', '--capture-sha256', 'BAD'], ['--on-topic', '--capture-sha256', '0'.repeat(64)]]) {
    const before = snapshotWorkspace(run.runDir);
    await assert.rejects(runDispatch(command(run, extra), native), /attestation|SHA-256/);
    assert.deepEqual(snapshotWorkspace(run.runDir), before);
    assert.equal(native.calls(), 1);
  }
});

test('pending output cannot satisfy a dependent verifier', async t => {
  const run = createSealedRun(t, [{ unitId: 'u1', vendor: 'anthropic', model: 'sonnet', effort: 'medium' },
    { unitId: 'u1', role: 'verify', class: 'test-verification', vendor: 'openai', model: 'gpt-5.6-terra', effort: 'medium', authorVendor: 'anthropic' }]);
  const native = fakeVendor();
  await runDispatch(command(run), native);
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd2' }, native), /implementation must finish/);
  assert.equal(native.calls(), 1);
});

test('attestation rejects changed capture brief workspace rules and skills without relaunching', async t => {
  const changes = [
    ['capture', (run, result) => fs.appendFileSync(result.capturePath, '\nchanged', 'utf8')],
    ['brief', run => fs.appendFileSync(run.dispatches[0].brief, '\nchanged', 'utf8')],
    ['workspace', run => fs.appendFileSync(path.join(run.cwd, 'result.txt'), '\nchanged', 'utf8')],
    ['rules', run => fs.appendFileSync(path.join(run.opts.rulesRoot, 'STANDING.md'), '\nchanged', 'utf8')],
    ['skills', run => fs.appendFileSync(path.join(run.opts.skillSourceRoot, fs.readdirSync(run.opts.skillSourceRoot)[0], 'SKILL.md'), '\nchanged', 'utf8')],
  ];
  for (const [name, change] of changes) {
    const run = claudeRun(t);
    const native = fakeVendor();
    const pending = await runDispatch(command(run), native);
    change(run, pending);
    const before = snapshotWorkspace(run.runDir);
    await assert.rejects(accept(run, pending, native), /changed|differs/, name);
    assert.deepEqual(snapshotWorkspace(run.runDir), before);
    assert.equal(native.calls(), 1);
    assert.equal(saved(run).state.status, 'AWAITING_ATTESTATION');
  }
});

test('native replay rejects a malformed checkpoint payload even after refreshed artifact digests', async t => {
  const run = claudeRun(t);
  const native = fakeVendor();
  const pending = await runDispatch(command(run), native);
  rewriteArtifact(run, 'capture.txt', text => {
    const row = JSON.parse(text); delete row.structured_output; row.result = 'ACK fixture\nPOSITION: APPROVE';
    return JSON.stringify(row);
  });
  await assert.rejects(accept(run, pending, native), /structured_output/);
  assert.equal(native.calls(), 1);
});

test('attestation requires unchanged runtime bytes from the recorded launch', async t => {
  const run = claudeRun(t);
  const runtime = path.join(run.root, 'runtime');
  fs.cpSync(__dirname, path.join(runtime, 'tools'), { recursive: true });
  const refs = '.cursor/skills/magi-cli/references';
  fs.mkdirSync(path.join(runtime, refs), { recursive: true });
  for (const name of ['dispatch-matrix.json', 'seat-profiles.json']) fs.copyFileSync(path.join(__dirname, '..', refs, name), path.join(runtime, refs, name));
  const isolatedDispatch = require(path.join(runtime, 'tools/dispatch-run.js')).runDispatch;
  const native = fakeVendor();
  const pending = await isolatedDispatch(command(run), native);
  fs.appendFileSync(path.join(runtime, 'tools/dispatch-run.js'), '\n// Changed after launch.\n', 'utf8');
  await assert.rejects(isolatedDispatch(command(run, ['--on-topic', '--capture-sha256', pending.captureSha256]), native), /current runtime/);
  assert.equal(native.calls(), 1);
});

test('attestation revalidates prerequisite transactions before committing a verifier', async t => {
  const run = createSealedRun(t, [{ unitId: 'u1' }, { unitId: 'u1', role: 'verify', class: 'test-verification', vendor: 'anthropic', model: 'sonnet', effort: 'medium', authorVendor: 'openai' }]);
  const native = fakeVendor();
  await runDispatch({ ...run.opts, dispatchId: 'd1' }, native);
  const pending = await runDispatch({ ...run.opts, dispatchId: 'd2' }, native);
  const author = saved(run);
  author.state.unrelated = 'changed prerequisite transaction';
  writeJson(author.file, author.state);
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd2', onTopic: true, captureSha256: pending.captureSha256 }, native), /sequence prerequisites/);
  assert.equal(native.calls(), 2);
});

test('post-run acceptance uses launch-time probes but expired-before-launch evidence is rejected', async t => {
  const run = claudeRun(t);
  const native = fakeVendor();
  const pending = await runDispatch(command(run), native);
  const unstarted = claudeRun(t);
  const future = Date.now() + 61 * 60 * 1000;
  t.mock.method(Date, 'now', () => future);
  assert.equal((await accept(run, pending, native)).ok, true);
  assert.equal((await runDispatch(command(run), native)).replayed, true);
  const noChild = fakeVendor();
  await assert.rejects(runDispatch(command(unstarted), noChild), /probe|fresh|availability/i);
  assert.equal(native.calls(), 1);
  assert.equal(noChild.calls(), 0);
});

test('missing corrupt or downgraded attestation evidence cannot become a completed replay', async t => {
  for (const mutation of ['missing', 'hash', 'capture', 'protocol']) {
    const run = claudeRun(t);
    const native = fakeVendor();
    const pending = await runDispatch(command(run), native);
    await accept(run, pending, native);
    const folder = path.dirname(pending.capturePath);
    if (mutation === 'missing') fs.rmSync(path.join(folder, 'attestation.json'));
    if (mutation === 'hash') fs.appendFileSync(path.join(folder, 'attestation.json'), '\nchanged', 'utf8');
    if (mutation === 'capture') rewriteArtifact(run, 'attestation.json', text => JSON.stringify({ ...JSON.parse(text), captureSha256: '0'.repeat(64) }));
    if (mutation === 'protocol') rewriteArtifact(run, 'launch.json', text => { const value = JSON.parse(text); delete value.attestationProtocol; return JSON.stringify(value); });
    assert.equal(inspectRun(run.runDir).outcomes[0].status, 'INVALID');
    await assert.rejects(runDispatch(command(run), native));
    assert.equal(native.calls(), 1);
  }
});

test('failed Claude transactions remain terminal and cannot be attested', async t => {
  const run = claudeRun(t);
  const native = fakeVendor(() => { throw new Error('synthetic child failure'); });
  await assert.rejects(runDispatch(command(run), native), /synthetic child failure/);
  const before = snapshotWorkspace(run.runDir);
  await assert.rejects(runDispatch(command(run, ['--on-topic', '--capture-sha256', '0'.repeat(64)]), native), /existing Claude checkpoint/);
  await assert.rejects(runDispatch(command(run), native), /logical dispatch is FAIL/);
  assert.deepEqual(snapshotWorkspace(run.runDir), before);
  assert.equal(native.calls(), 1);
});

test('a concurrent attestation lock prevents duplicate commits without changing the checkpoint', async t => {
  const run = claudeRun(t);
  const native = fakeVendor();
  const pending = await runDispatch(command(run), native);
  const lock = `${saved(run).file}.attestation.lock`;
  fs.writeFileSync(lock, '', { flag: 'wx' });
  const before = snapshotWorkspace(run.runDir);
  await assert.rejects(accept(run, pending, native), /attestation is already in progress/);
  assert.deepEqual(snapshotWorkspace(run.runDir), before);
  fs.rmSync(lock);
  assert.equal((await accept(run, pending, native)).ok, true);
  assert.equal(native.calls(), 1);
});

test('altered pending log destinations cannot escape the sealed run during acceptance', async t => {
  const run = claudeRun(t);
  const native = fakeVendor();
  const pending = await runDispatch(command(run), native);
  const { file, state } = saved(run);
  const outside = path.join(run.root, 'outside-run.jsonl');
  state.logs = [outside];
  writeJson(file, state);
  const before = snapshotWorkspace(run.runDir);
  await assert.rejects(accept(run, pending, native), /log destination/);
  assert.deepEqual(snapshotWorkspace(run.runDir), before);
  assert.equal(fs.existsSync(outside), false);
  assert.equal(native.calls(), 1);
});

test('removed reordered duplicated or substituted pending log destinations reject without writes', async t => {
  const mutations = [
    state => { delete state.logs; },
    state => { state.logs = []; },
    state => { state.logs.reverse(); },
    state => { state.logs.push(state.logs[0]); },
    (state, run) => { state.logs = [path.join(run.runDir, 'substituted.jsonl')]; },
  ];
  for (const mutate of mutations) {
    const run = claudeRun(t);
    const native = fakeVendor();
    const pending = await runDispatch(command(run), native);
    const { file, state } = saved(run);
    mutate(state, run);
    writeJson(file, state);
    const before = snapshotWorkspace(run.runDir);
    await assert.rejects(accept(run, pending, native), /log destinations/);
    assert.deepEqual(snapshotWorkspace(run.runDir), before);
    assert.equal(inspectRun(run.runDir).outcomes[0].status, 'INVALID');
    assert.equal(native.calls(), 1);
  }
});

test('custom and shared log destinations stay bound through acceptance replay and finalization', async t => {
  for (const shared of [false, true]) {
    const run = claudeRun(t);
    const native = fakeVendor();
    const telemetryLog = path.join(run.runDir, 'custom', 'telemetry.jsonl');
    const activationLog = shared ? telemetryLog : path.join(run.runDir, 'custom', 'activation.jsonl');
    const pending = await runDispatch(command(run, ['--telemetry-log', telemetryLog, '--activation-log', activationLog]), native);
    const destinations = { telemetryLog, activationLog };
    for (const name of ['launch.json', 'checkpoint.json', 'handoff-envelope.json']) {
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(pending.capturePath), name), 'utf8')).logDestinations, destinations);
    }
    // Resume without custom flags still uses the original protected destinations.
    const accepted = await accept(run, pending, native);
    assert.equal(accepted.ok, true);
    assert.equal((await accept(run, pending, native)).replayed, true);
    assert.equal(finalizeRun(run.runDir).executionStatus, 'PASS');
    for (const log of new Set([telemetryLog, activationLog])) {
      const rows = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
      assert.deepEqual(rows, [accepted.telemetry]);
    }
    assert.equal(fs.existsSync(path.join(run.runDir, 'telemetry', 'dispatches.jsonl')), false);
    assert.equal(fs.existsSync(path.join(run.runDir, 'magi-dispatch-log.jsonl')), false);
    assert.equal(native.calls(), 1);
  }
});

test('committed destination substitution is invalid even when the replacement contains matching telemetry', async t => {
  const run = claudeRun(t);
  const native = fakeVendor();
  const pending = await runDispatch(command(run), native);
  const accepted = await accept(run, pending, native);
  const outside = path.join(run.root, 'matching-outside.jsonl');
  fs.writeFileSync(outside, `${JSON.stringify(accepted.telemetry)}\n`, 'utf8');
  const outsideHash = hashFile(outside);
  const { file, state } = saved(run);
  state.logs = [outside];
  writeJson(file, state);
  assert.equal(inspectRun(run.runDir).outcomes[0].status, 'INVALID');
  assert.equal(finalizeRun(run.runDir).executionStatus, 'FAIL');
  await assert.rejects(runDispatch(command(run), native), /log destinations/);
  assert.equal(hashFile(outside), outsideHash);
  assert.equal(native.calls(), 1);
});

test('rewritten protected log destinations still cannot target a product or leave the run', async t => {
  for (const product of [false, true]) {
    const run = claudeRun(t);
    const native = fakeVendor();
    const pending = await runDispatch(command(run), native);
    const destination = path.join(product ? run.cwd : run.root, 'escape.jsonl');
    rewriteArtifact(run, 'launch.json', text => JSON.stringify({ ...JSON.parse(text), logDestinations: { telemetryLog: destination, activationLog: destination } }));
    const before = snapshotWorkspace(run.runDir);
    await assert.rejects(accept(run, pending, native), /log destinations must remain inside/);
    assert.deepEqual(snapshotWorkspace(run.runDir), before);
    assert.equal(fs.existsSync(destination), false);
    assert.equal(native.calls(), 1);
  }
});

test('a log parent replaced by a junction cannot redirect acceptance writes', async t => {
  const run = claudeRun(t);
  const native = fakeVendor();
  const parent = path.join(run.runDir, 'custom-logs');
  const pending = await runDispatch(command(run, ['--telemetry-log', path.join(parent, 'telemetry.jsonl'), '--activation-log', path.join(parent, 'activation.jsonl')]), native);
  const target = path.join(run.root, 'outside-target');
  fs.mkdirSync(target);
  fs.symlinkSync(target, parent, 'junction');
  const transaction = saved(run);
  const before = fs.readFileSync(transaction.file);
  await assert.rejects(accept(run, pending, native), /symlink|junction/);
  assert.equal(fs.readFileSync(transaction.file).equals(before), true);
  assert.deepEqual(fs.readdirSync(target), []);
  assert.equal(native.calls(), 1);
});

test('a log destination cannot overlap native capture evidence before a child starts', async t => {
  const run = claudeRun(t);
  const native = fakeVendor();
  const capture = path.join(run.runDir, 'out', 'd1', 'capture.txt');
  const before = snapshotWorkspace(run.runDir);
  await assert.rejects(runDispatch(command(run, ['--telemetry-log', capture]), native), /log destination.*overlap/);
  assert.equal(native.calls(), 0);
  assert.deepEqual(snapshotWorkspace(run.runDir), before);
});

test('initial log destinations cannot overwrite evidence directories run controls or planned evidence', async t => {
  const paths = [
    run => path.join(run.runDir, 'out', 'd1'),
    run => path.join(run.runDir, 'out'),
    run => path.join(run.runDir, 'out', 'd2', 'future.log'),
    run => path.join(run.runDir, '.magi-dispatches', `${transactionKey(run.dispatches[0])}.json`),
    run => path.join(run.runDir, '.magi-sessions', 'session.json'),
    run => run.opts.plan,
    run => path.join(run.runDir, 'plan-seal.json'),
    run => path.join(run.runDir, 'availability.json'),
    run => path.join(run.runDir, 'run-summary.json'),
    run => path.join(run.runDir, 'implementation.jsonl'),
  ];
  for (const output of paths) {
    const run = createSealedRun(t, [{ unitId: 'u1', vendor: 'anthropic', model: 'sonnet', effort: 'medium' },
      { unitId: 'u1', role: 'verify', class: 'test-verification', vendor: 'openai', model: 'gpt-5.6-terra', effort: 'medium', authorVendor: 'anthropic' }]);
    const native = fakeVendor();
    const before = snapshotWorkspace(run.runDir);
    await assert.rejects(runDispatch(command(run, ['--activation-log', output(run)]), native), /log destination.*overlap/);
    assert.equal(native.calls(), 0);
    assert.deepEqual(snapshotWorkspace(run.runDir), before);
  }
});

test('logs cannot replace protected rule inputs stored inside the run', async t => {
  const run = claudeRun(t);
  const rulesRoot = path.join(run.runDir, 'source-rules');
  fs.cpSync(run.opts.rulesRoot, rulesRoot, { recursive: true });
  const native = fakeVendor();
  const before = snapshotWorkspace(run.runDir);
  await assert.rejects(runDispatch({ ...command(run), rulesRoot, telemetryLog: path.join(rulesRoot, 'STANDING.md') }, native), /log destination.*overlap/);
  assert.equal(native.calls(), 0);
  assert.deepEqual(snapshotWorkspace(run.runDir), before);
});

test('logs cannot overwrite a prerequisite in a custom evidence directory', async t => {
  const run = createSealedRun(t, [{ unitId: 'u1' },
    { unitId: 'u1', role: 'verify', class: 'test-verification', vendor: 'anthropic', model: 'sonnet', effort: 'medium', authorVendor: 'openai' }]);
  const native = fakeVendor();
  const evidenceDir = path.join(run.runDir, 'custom-author-evidence');
  await runDispatch({ ...run.opts, dispatchId: 'd1', evidenceDir }, native);
  const capture = path.join(evidenceDir, 'capture.txt');
  const captureHash = hashFile(capture);
  const before = snapshotWorkspace(run.runDir);
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd2', telemetryLog: capture }, native), /log destination.*overlap/);
  assert.equal(native.calls(), 1);
  assert.equal(hashFile(capture), captureHash);
  assert.deepEqual(snapshotWorkspace(run.runDir), before);
});

test('saved launch destination corruption cannot append into native evidence during acceptance', async t => {
  const run = claudeRun(t);
  const native = fakeVendor();
  const pending = await runDispatch(command(run), native);
  rewriteArtifact(run, 'launch.json', text => {
    const launch = JSON.parse(text);
    launch.logDestinations.telemetryLog = pending.capturePath;
    return JSON.stringify(launch);
  });
  const before = snapshotWorkspace(run.runDir);
  await assert.rejects(accept(run, pending, native), /log destination.*overlap/);
  assert.deepEqual(snapshotWorkspace(run.runDir), before);
  assert.equal(hashFile(pending.capturePath), pending.captureSha256);
  assert.equal(inspectRun(run.runDir).outcomes[0].status, 'INVALID');
  assert.equal(native.calls(), 1);
});
