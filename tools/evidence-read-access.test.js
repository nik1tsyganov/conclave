// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { temporary, createSealedRun, fakeVendor } = require('./test-fixtures.js');
const { buildLaunch } = require('./cli-adapters.js');
const { validateEvidenceReadDirs, snapshotEvidenceReads, validateEvidenceReadLaunch, observeEvidenceReads } = require('./evidence-read-access.js');
const { sealPlan, readSealedRun } = require('./plan-seal.js');
const { runDispatch } = require('./dispatch-run.js');
const { inspectRun } = require('./run-finalize.js');
const { hashFile, writeJson, transactionKey } = require('./dispatch-evidence.js');
const { canonicalPlainPath } = require('./runtime-paths.js');

function accessFixture(t, vendor = 'google') {
  const route = vendor === 'anthropic' ? { vendor, model: 'opus', effort: 'high' } : { vendor, model: 'gemini-3.1-pro-high', effort: 'fused-high' };
  const run = createSealedRun(t, [{ ...route, role: 'review', class: 'review-adversarial', authorVendor: 'openai' }]);
  run.runDir = path.join(run.root, 'access-run');
  run.evidence = path.join(run.root, 'evidence');
  run.dispatches[0].evidenceReadDirs = [run.evidence];
  writeJson(run.planSource, run.planObject);
  const sealed = sealPlan({ noJev: 'test fixture', plan: run.planSource, runDir: run.runDir, availability: run.availability, skillSourceRoot: run.opts.skillSourceRoot });
  run.opts = { ...run.opts, runDir: run.runDir, plan: sealed.planPath };
  return run;
}
function nativeFixture(action) {
  const native = fakeVendor(action, 'ACK fixture\nDone.\nPOSITION: APPROVE');
  native.buildLaunch = opts => ({ ...opts, ...buildLaunch({ ...opts, mustExistBinary: false,
    env: { CONCLAVE_ALLOWED_WORKSPACE_ROOTS: opts.cwd, CONCLAVE_CLAUDE_BIN: process.execPath, CONCLAVE_AGY_BIN: process.execPath, CONCLAVE_CODEX_BIN: process.execPath } }) });
  return native;
}
function inputs(run) { fs.mkdirSync(run.evidence); fs.writeFileSync(path.join(run.evidence, 'browser.json'), '{"case":"synthetic"}'); }
function granted(args, dir) {
  const target = canonicalPlainPath(dir);
  return args.some(arg => typeof arg === 'string' && path.isAbsolute(arg) && canonicalPlainPath(arg) === target);
}
async function complete(run, native) {
  const result = await runDispatch({ ...run.opts, dispatchId: 'd1' }, native);
  return result.status === 'AWAITING_ATTESTATION' ? runDispatch({ ...run.opts, dispatchId: 'd1', onTopic: true, captureSha256: result.captureSha256 }, native) : result;
}

test('Google checking launch grants the explicitly bound sibling evidence directory', t => {
  const root = temporary(t, 'conclave-read-access-');
  const briefPath = path.join(root, 'BRIEF.md'); fs.writeFileSync(briefPath, 'ACK evidence\n');
  const evidence = path.join(root, 'evidence'); fs.mkdirSync(evidence);
  const launch = buildLaunch({ vendor: 'google', role: 'review', cwd: '/opt/conclave/src/synthetic-product',
    briefPath, seatContractPath: path.join(root, 'SEAT-CONTRACT.md'), skillRoot: path.join(root, 'skills'),
    capturePath: path.join(root, 'capture.txt'), evidenceReadDirs: [evidence],
    env: { CONCLAVE_AGY_BIN: process.execPath, CONCLAVE_DEV_ROOT: '/opt/conclave/src' }, mustExistBinary: false });
  assert.ok(granted(launch.args, evidence), 'sealed sibling evidence must be in native add-dir grants');
  assert.ok(launch.args.includes('--sandbox'));
});

for (const vendor of ['google', 'anthropic']) {
  test(`${vendor} sealed planned evidence can be created later, read at launch, and replayed without another call`, async t => {
    const run = accessFixture(t, vendor); const native = nativeFixture();
    assert.equal(fs.existsSync(run.evidence), false);
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /directory must exist/);
    assert.equal(native.calls(), 0);
    inputs(run);
    assert.equal((await complete(run, native)).ok, true);
    assert.equal((await runDispatch({ ...run.opts, dispatchId: 'd1' }, native)).replayed, true);
    assert.equal(native.calls(), 1);
    const launch = JSON.parse(fs.readFileSync(path.join(run.runDir, 'out/d1/launch.json')));
    assert.deepEqual(launch.evidenceReadDirs, [canonicalPlainPath(run.evidence)]);
    assert.ok(granted(launch.args, run.evidence));
    assert.equal(inspectRun(run.runDir).executions.length, 1);
  });
}

function authorlessChecks(t) {
  const run = createSealedRun(t, [
    { unitId: 'u1', vendor: 'anthropic', model: 'opus', effort: 'medium', role: 'verify', class: 'test-verification', authorVendor: 'openai' },
    { unitId: 'u1', vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high', role: 'review', class: 'review-adversarial', authorVendor: 'openai' },
  ]);
  run.runDir = path.join(run.root, 'access-run');
  run.dispatches[1].evidenceReadDirs = [path.join(run.runDir, 'out/d1')];
  writeJson(run.planSource, run.planObject);
  const sealed = sealPlan({ noJev: 'test fixture', plan: run.planSource, runDir: run.runDir, availability: run.availability, skillSourceRoot: run.opts.skillSourceRoot });
  run.opts = { ...run.opts, runDir: run.runDir, plan: sealed.planPath };
  return run;
}

test('forged minimal PASS from an authorless verifier cannot authorize a review child', async t => {
  const run = authorlessChecks(t); const native = nativeFixture(); const dir = path.join(run.runDir, 'out/d1');
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'fake.txt'), 'not native evidence');
  writeJson(path.join(run.runDir, '.conclave-dispatches', `${transactionKey(run.dispatches[0])}.json`), {
    status: 'PASS', completedAt: new Date().toISOString(), evidenceDir: dir,
  });
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd2' }, native));
  assert.equal(native.calls(), 0);
});

test('authorless review can read a fully verified earlier same-unit APPROVE output', async t => {
  const run = authorlessChecks(t); const native = nativeFixture();
  for (const dispatchId of ['d1', 'd2']) assert.equal((await require('./test-fixtures.js').completeSyntheticDispatch({ ...run.opts, dispatchId }, native)).ok, true);
  const launch = JSON.parse(fs.readFileSync(path.join(run.runDir, 'out/d2/launch.json')));
  assert.equal(launch.prerequisites.length, 1); assert.equal(launch.prerequisites[0].dispatchId, 'd1');
  assert.equal(inspectRun(run.runDir).executions.length, 2);
  assert.equal(native.calls(), 2);
});

for (const [label, mutate] of Object.entries({
  'changed predecessor capture': run => fs.appendFileSync(path.join(run.runDir, 'out/d1/capture.txt'), 'changed'),
  'future committed timestamp': run => {
    const file = path.join(run.runDir, '.conclave-dispatches', `${transactionKey(run.dispatches[0])}.json`);
    const state = JSON.parse(fs.readFileSync(file)); state.completedAt = new Date(Date.now() + 60000).toISOString(); writeJson(file, state);
  },
})) {
  test(`authorless review rejects ${label} before a child`, async t => {
    const run = authorlessChecks(t); const native = nativeFixture();
    await require('./test-fixtures.js').completeSyntheticDispatch({ ...run.opts, dispatchId: 'd1' }, native);
    mutate(run);
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd2' }, native));
    assert.equal(native.calls(), 1);
  });
}

test('authorless review requires native APPROVE from a granted verifier output', async t => {
  const run = authorlessChecks(t); const native = nativeFixture(); const execute = native.runLaunch;
  native.runLaunch = async launch => {
    const result = await execute(launch);
    if (launch.dispatchId === 'd1') result.stdout = result.stdout.split('\n').map(line => {
      if (!line.trim()) return line;
      const row = JSON.parse(line);
      if (row.type === 'result') { row.structured_output.response = row.structured_output.response.replace('POSITION: APPROVE', 'POSITION: REJECT'); row.result = JSON.stringify(row.structured_output); }
      return JSON.stringify(row);
    }).join('\n');
    return result;
  };
  await require('./test-fixtures.js').completeSyntheticDispatch({ ...run.opts, dispatchId: 'd1' }, native);
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd2' }, native), /verification did not approve/);
  assert.equal(native.calls(), 1);
});

for (const [label, mutate] of Object.entries({
  'edit': dir => fs.writeFileSync(path.join(dir, 'browser.json'), 'changed'),
  'add': dir => fs.writeFileSync(path.join(dir, 'new.txt'), 'changed'),
  'delete': dir => fs.unlinkSync(path.join(dir, 'browser.json')),
})) {
  test(`checking child cannot ${label} granted evidence`, async t => {
    const run = accessFixture(t); inputs(run);
    const native = nativeFixture(() => mutate(run.evidence));
    await assert.rejects(complete(run, native), /evidence inputs changed/);
    assert.equal(native.calls(), 1);
  });
  test(`replay and finalization reject ${label} after completed evidence reads`, async t => {
    const run = accessFixture(t); inputs(run); const native = nativeFixture(); await complete(run, native);
    mutate(run.evidence);
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /current evidence inputs/);
    const inspected = inspectRun(run.runDir);
    assert.equal(inspected.outcomes[0].status, 'INVALID');
    assert.match(inspected.outcomes[0].error, /current evidence inputs/);
    assert.equal(native.calls(), 1);
  });
}

test('sealed grants cannot be widened by launch substitution', async t => {
  const run = accessFixture(t); inputs(run); const native = nativeFixture(); const build = native.buildLaunch;
  native.buildLaunch = opts => { const launch = build(opts); launch.args.push('--add-dir', run.root); return launch; };
  await assert.rejects(complete(run, native), /native directory grants differ/);
  assert.equal(native.calls(), 0);
});

test('sealed grants cannot be widened by editing the plan', async t => {
  const run = accessFixture(t); inputs(run); const native = nativeFixture();
  const plan = JSON.parse(fs.readFileSync(run.opts.plan)); plan.dispatches[0].evidenceReadDirs = [run.root]; writeJson(run.opts.plan, plan);
  await assert.rejects(complete(run, native), /sealed run inputs changed/);
  assert.equal(native.calls(), 0);
});

for (const [label, select] of Object.entries({
  'attempt root': run => run.root,
  'run root': run => run.runDir,
  'output root': run => path.join(run.runDir, 'out'),
  'own output': run => path.join(run.runDir, 'out/d1'),
  'unknown output': run => path.join(run.runDir, 'out/unknown'),
  'product': run => run.cwd,
  'runtime': () => path.resolve(__dirname, '..'),
  'external sibling': run => path.join(run.root, 'arbitrary'),
})) {
  test(`plan rejects ${label} grants`, t => {
    const run = accessFixture(t); const entry = { ...run.dispatches[0], evidenceReadDirs: [select(run)] };
    assert.throws(() => validateEvidenceReadDirs(entry, { plan: run.planObject, runDir: run.runDir }), /evidenceReadDirs/);
  });
}

test('directory schema rejects implementation, relative paths, traversal, duplicates and nested grants', t => {
  const run = accessFixture(t); const entry = run.dispatches[0];
  for (const evidenceReadDirs of ['not-an-array', ['relative'], [run.evidence + '/../escape'], [run.evidence, run.evidence.toUpperCase()], [run.evidence, path.join(run.evidence, 'nested')]]) {
    assert.throws(() => validateEvidenceReadDirs({ ...entry, evidenceReadDirs }, { plan: run.planObject, runDir: run.runDir }));
  }
  assert.throws(() => validateEvidenceReadDirs({ ...entry, role: 'implement' }), /only checking/);
  assert.deepEqual(validateEvidenceReadDirs({ role: 'implement' }), []);
});

test('rules or skill sources nested under requested evidence cannot be granted', t => {
  const run = accessFixture(t);
  assert.throws(() => validateEvidenceReadDirs(run.dispatches[0], { plan: run.planObject, runDir: run.runDir, forbiddenRoots: [path.join(run.evidence, 'rules')] }), /protected directory/);
});

test('exact same-unit prerequisite output requires completed PASS evidence, not only plan order', t => {
  const run = accessFixture(t); const entry = run.dispatches[0];
  const prior = { ...entry, dispatchId: 'author', role: 'implement', evidenceReadDirs: undefined };
  const dir = path.join(run.runDir, 'out/author'); entry.evidenceReadDirs = [dir];
  const plan = { ...run.planObject, dispatches: [prior, entry] };
  assert.deepEqual(validateEvidenceReadDirs(entry, { plan, runDir: run.runDir }), [canonicalPlainPath(dir)]);
  fs.mkdirSync(dir, { recursive: true });
  const stateFile = path.join(run.runDir, '.conclave-dispatches', `${transactionKey(prior)}.json`);
  for (const status of ['RUNNING', 'AWAITING_ATTESTATION', 'FAIL']) {
    writeJson(stateFile, { status, evidenceDir: dir, completedAt: new Date().toISOString() });
    assert.throws(() => validateEvidenceReadDirs(entry, { plan, runDir: run.runDir, requireExisting: true }), /not complete/);
  }
  writeJson(stateFile, { status: 'PASS', evidenceDir: dir, completedAt: new Date().toISOString() });
  assert.deepEqual(validateEvidenceReadDirs(entry, { plan, runDir: run.runDir, requireExisting: true }), [canonicalPlainPath(dir)]);
  assert.throws(() => validateEvidenceReadDirs(entry, { plan: { dispatches: [{ ...prior, unitId: 'other' }, entry] }, runDir: run.runDir }), /same-unit prerequisite/);
});

test('reparse ancestors, linked descendants, and hardlink contents fail closed', t => {
  const run = accessFixture(t); inputs(run);
  const target = path.join(run.root, 'outside'); fs.mkdirSync(target);
  const link = path.join(run.evidence, 'alias'); fs.symlinkSync(target, link, 'dir');
  assert.throws(() => validateEvidenceReadDirs({ ...run.dispatches[0], evidenceReadDirs: [link] }, { plan: run.planObject, runDir: run.runDir }), /junction|symlink/);
  assert.throws(() => snapshotEvidenceReads([run.evidence]), /links/);
  fs.unlinkSync(link);
  fs.linkSync(path.join(run.evidence, 'browser.json'), path.join(run.evidence, 'hardlink'));
  assert.throws(() => snapshotEvidenceReads([run.evidence]), /hard links/);
});

test('complete prior author evidence is available to both checking seats through finalization', async t => {
  const run = createSealedRun(t, [
    { unitId: 'u1' },
    { unitId: 'u1', vendor: 'anthropic', model: 'opus', effort: 'medium', role: 'verify', class: 'test-verification', authorVendor: 'openai' },
    { unitId: 'u1', vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high', role: 'review', class: 'review-adversarial', authorVendor: 'openai' },
  ]);
  run.runDir = path.join(run.root, 'access-run'); run.evidence = path.join(run.root, 'evidence');
  for (const entry of run.dispatches.slice(1)) entry.evidenceReadDirs = [run.evidence, path.join(run.runDir, 'out/d1')];
  writeJson(run.planSource, run.planObject);
  const sealed = sealPlan({ noJev: 'test fixture', plan: run.planSource, runDir: run.runDir, availability: run.availability, skillSourceRoot: run.opts.skillSourceRoot });
  run.opts = { ...run.opts, runDir: run.runDir, plan: sealed.planPath };
  const native = nativeFixture();
  await require('./test-fixtures.js').completeSyntheticDispatch({ ...run.opts, dispatchId: 'd1' }, native);
  inputs(run);
  for (const dispatchId of ['d2', 'd3']) assert.equal((await require('./test-fixtures.js').completeSyntheticDispatch({ ...run.opts, dispatchId }, native)).ok, true);
  const result = require('./run-finalize.js').finalizeRun(run.runDir);
  assert.equal(result.executionStatus, 'PASS');
  assert.equal(result.ok, true);
  assert.equal(native.calls(), 3);
  assert.equal(inspectRun(run.runDir).executions.length, 3);
});

test('OpenAI evidence grants leave the exact scratch argv and environment unchanged', t => {
  const root = temporary(t, 'conclave-evidence-scratch-'); const runDir = path.join(root, 'run');
  const output = path.join(runDir, 'out/d1'); fs.mkdirSync(output, { recursive: true });
  const briefPath = path.join(output, 'BRIEF.md'); fs.writeFileSync(briefPath, 'ACK evidence\n');
  const evidence = path.join(root, 'evidence'); fs.mkdirSync(evidence);
  const opts = { vendor: 'openai', role: 'verify', cwd: '/opt/conclave/src/synthetic-product', runDir, dispatchId: 'd1', readonlyScratch: true,
    briefPath, seatContractPath: path.join(output, 'SEAT-CONTRACT.md'), skillRoot: path.join(output, 'skills'), capturePath: path.join(output, 'capture.txt'),
    env: { CONCLAVE_CODEX_BIN: process.execPath, CONCLAVE_DEV_ROOT: '/opt/conclave/src' }, mustExistBinary: false };
  const before = buildLaunch(opts); const after = buildLaunch({ ...opts, evidenceReadDirs: [evidence] });
  assert.deepEqual(after.args, before.args); assert.deepEqual(after.env, before.env);
  assert.deepEqual(after.evidenceReadDirs, [canonicalPlainPath(evidence)]);
});

test('replay checks sealed directory grants even after a launch artifact hash is refreshed', async t => {
  const run = accessFixture(t); inputs(run); const native = nativeFixture(); await complete(run, native);
  const stateFile = path.join(run.runDir, '.conclave-dispatches', `${transactionKey(run.dispatches[0])}.json`);
  const state = JSON.parse(fs.readFileSync(stateFile)); const file = path.join(run.runDir, 'out/d1/launch.json');
  const launch = JSON.parse(fs.readFileSync(file)); launch.args.push('--add-dir', run.root); writeJson(file, launch);
  state.artifacts.find(item => item.path === file).sha256 = hashFile(file); writeJson(stateFile, state);
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /native directory grants differ/);
  assert.equal(native.calls(), 1);
});

test('replay rejects rewritten evidence snapshots after their artifact hashes are refreshed', async t => {
  const run = accessFixture(t); inputs(run); const native = nativeFixture(); await complete(run, native);
  const stateFile = path.join(run.runDir, '.conclave-dispatches', `${transactionKey(run.dispatches[0])}.json`);
  const state = JSON.parse(fs.readFileSync(stateFile));
  fs.writeFileSync(path.join(run.evidence, 'browser.json'), 'rewritten');
  for (const name of ['evidence-reads-before.json', 'evidence-reads-after.json']) {
    const file = path.join(run.runDir, 'out/d1', name); writeJson(file, snapshotEvidenceReads([run.evidence]));
    state.artifacts.find(item => item.path === file).sha256 = hashFile(file);
  }
  writeJson(stateFile, state);
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /hashes differ from launch binding/);
  assert.equal(native.calls(), 1);
});

for (const vendor of ['google', 'anthropic']) {
  test(`${vendor} cannot broaden permissions alongside evidence access`, async t => {
    const run = accessFixture(t, vendor); inputs(run); const native = nativeFixture(); const build = native.buildLaunch;
    native.buildLaunch = opts => { const launch = build(opts); launch.args.push(...(vendor === 'google' ? ['--yolo'] : ['--permission-mode', 'bypassPermissions'])); return launch; };
    await assert.rejects(complete(run, native), /must remain/);
    assert.equal(native.calls(), 0);
  });
}

function observeFixture(t) {
  const root = temporary(t, 'conclave-evidence-observe-');
  const evidence = path.join(root, 'evidence'); fs.mkdirSync(evidence);
  fs.writeFileSync(path.join(evidence, 'diff.txt'), 'diff body');
  fs.writeFileSync(path.join(evidence, 'test-output.txt'), 'ok');
  return evidence;
}

test('observeEvidenceReads counts an absolute path mention as a path match', t => {
  const evidence = observeFixture(t);
  const seen = observeEvidenceReads({ captureText: `I opened ${path.join(evidence, 'diff.txt')} and checked it`, dirs: [evidence] });
  assert.equal(seen.totalCount, 2);
  assert.equal(seen.seenCount, 1);
  const row = seen.files.find(file => file.name === 'diff.txt');
  assert.deepEqual({ path: row.path, name: row.name, seen: row.seen, match: row.match }, { path: path.join(evidence, 'diff.txt'), name: 'diff.txt', seen: true, match: 'path' });
  assert.equal(seen.files.find(file => file.name === 'test-output.txt').seen, false);
});

test('observeEvidenceReads falls back to a distinctive basename as a name match', t => {
  const evidence = observeFixture(t);
  const seen = observeEvidenceReads({ captureText: 'the diff.txt shows no other changes', dirs: [evidence] });
  assert.equal(seen.seenCount, 1);
  const row = seen.files.find(file => file.name === 'diff.txt');
  assert.equal(row.seen, true);
  assert.equal(row.match, 'name');
});

test('observeEvidenceReads records an unmentioned file as unseen', t => {
  const evidence = observeFixture(t);
  const seen = observeEvidenceReads({ captureText: 'POSITION: APPROVE\nnothing else to say', dirs: [evidence] });
  assert.equal(seen.totalCount, 2);
  assert.equal(seen.seenCount, 0);
  assert.ok(seen.files.every(file => file.seen === false && file.match === null));
});

test('observeEvidenceReads never throws on a missing directory or absent capture', t => {
  const evidence = observeFixture(t);
  const missing = observeEvidenceReads({ captureText: 'diff.txt', dirs: [path.join(evidence, 'gone')] });
  assert.deepEqual(missing, { files: [], seenCount: 0, totalCount: 0 });
  for (const captureText of ['', null, undefined]) {
    const seen = observeEvidenceReads({ captureText, dirs: [evidence] });
    assert.equal(seen.totalCount, 2);
    assert.equal(seen.seenCount, 0);
    assert.ok(seen.files.every(file => file.seen === false && file.match === null));
  }
});
