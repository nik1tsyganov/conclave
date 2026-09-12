'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readSealedRun, sealPlan } = require('./plan-seal.js');
const { createSealedRun, fakeVendor } = require('./test-fixtures.js');
const { runDispatch } = require('./dispatch-run.js');
const { hashFile, writeJson } = require('./dispatch-evidence.js');
const { canonicalPlainPath } = require('./runtime-paths.js');

test('seal binds required skill bytes and source identity before first dispatch', t => {
  const run = createSealedRun(t);
  const { seal } = readSealedRun(run.runDir);
  assert.equal(seal.schemaVersion, 2);
  assert.equal(seal.skillSource.sourceRoot, canonicalPlainPath(run.opts.skillSourceRoot));
  assert.equal(seal.skillSource.skills.implement[0].sha256,
    hashFile(path.join(run.opts.skillSourceRoot, 'implement/SKILL.md')));
  assert.deepEqual(Object.keys(seal.skillSource.skills).sort(), ['implement', 'seat-openai', 'testing']);
  assert.equal(fs.existsSync(path.join(run.runDir, 'out')), false);
});

test('missing required source instruction fails before sealing creates output', t => {
  const run = createSealedRun(t); const runDir = path.join(run.root, 'missing-source-run');
  fs.unlinkSync(path.join(run.opts.skillSourceRoot, 'testing/SKILL.md'));
  assert.throws(() => sealPlan({ plan: run.planSource, runDir, availability: run.availability,
    skillSourceRoot: run.opts.skillSourceRoot }), /missing SKILL.md/);
  assert.equal(fs.existsSync(runDir), false);
});

test('new seals reject missing lesson schema before creating output', t => {
  const run = createSealedRun(t);
  const profiles = JSON.parse(readSealedRun(run.runDir).seal.profilesText);
  delete profiles.schemaVersion;
  const runtime = path.join(run.root, 'runtime');
  require('./install-plugin.js').installMagiCursorCli({ destination: runtime });
  const profilesFile = path.join(runtime, 'skills/magi-cli/references/seat-profiles.json');
  writeJson(profilesFile, profiles);
  const runDir = path.join(run.root, 'invalid-policy-run');
  const child = require('node:child_process').spawnSync(process.execPath,
    [path.join(runtime, 'tools/plan-seal.js'), '--plan', run.planSource, '--run-dir', runDir,
      '--availability', run.availability, '--skill-source-root', run.opts.skillSourceRoot], { encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /operational lessons/);
  assert.equal(fs.existsSync(runDir), false);
});

test('schema 6 lesson-free historical snapshot stays readable without rewriting it', t => {
  const run = createSealedRun(t);
  const file = path.join(run.runDir, 'plan-seal.json');
  const seal = JSON.parse(fs.readFileSync(file, 'utf8'));
  const profiles = JSON.parse(seal.profilesText);
  profiles.schemaVersion = 6; delete profiles.operationalLessons;
  seal.profilesText = JSON.stringify(profiles);
  seal.profilesSha256 = require('./dispatch-matrix.js').sha256(seal.profilesText);
  writeJson(file, seal);
  const original = hashFile(file);
  assert.equal(JSON.parse(readSealedRun(run.runDir).seal.profilesText).schemaVersion, 6);
  assert.equal(hashFile(file), original);
});

test('saved seal remains readable and completed replay immutable after source skill changes', async t => {
  const run = createSealedRun(t); const native = fakeVendor(); const opts = { ...run.opts, dispatchId: 'd1' };
  const first = await runDispatch(opts, native);
  const file = path.join(run.runDir, 'plan-seal.json'); const original = hashFile(file);
  fs.appendFileSync(path.join(run.opts.skillSourceRoot, 'implement/SKILL.md'), '\nNew runtime skill content.');
  assert.equal(readSealedRun(run.runDir).seal.planHash, first.receipt.planHash);
  assert.equal((await runDispatch(opts, native)).replayed, true);
  assert.equal(hashFile(file), original); assert.equal(native.calls(), 1);
});

test('policy snapshot corruption rejects reads and dispatch with no child', async t => {
  const run = createSealedRun(t); const native = fakeVendor();
  const file = path.join(run.runDir, 'plan-seal.json'); const seal = JSON.parse(fs.readFileSync(file, 'utf8'));
  seal.matrixText += '\n'; writeJson(file, seal);
  assert.throws(() => readSealedRun(run.runDir), /policy snapshots changed/);
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /policy snapshots changed/);
  assert.equal(native.calls(), 0);
});

test('historical policy snapshot remains readable but a differing installed policy cannot launch new work', async t => {
  const run = createSealedRun(t); const native = fakeVendor();
  const file = path.join(run.runDir, 'plan-seal.json'); const seal = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Simulate an archived, self-consistent policy snapshot without changing runtime files.
  const matrix = JSON.parse(seal.matrixText); matrix.historicalFixture = true;
  seal.matrixText = JSON.stringify(matrix);
  seal.matrixSha256 = require('./dispatch-matrix.js').sha256(seal.matrixText); writeJson(file, seal);
  const original = hashFile(file);
  assert.equal(readSealedRun(run.runDir).matrix.historicalFixture, true);
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /installed runtime policy differs/);
  assert.equal(native.calls(), 0); assert.equal(hashFile(file), original);
});

test('legacy unbound plans stay readable but cannot launch new work or rewrite their seal', async t => {
  const run = createSealedRun(t); const native = fakeVendor();
  const file = path.join(run.runDir, 'plan-seal.json'); const seal = JSON.parse(fs.readFileSync(file, 'utf8'));
  seal.schemaVersion = 1; delete seal.skillSource; delete seal.matrixText; delete seal.profilesText;
  writeJson(file, seal); const original = hashFile(file);
  assert.equal(readSealedRun(run.runDir).seal.schemaVersion, 1);
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /unbound historical seal/);
  assert.equal(native.calls(), 0); assert.equal(hashFile(file), original);
  assert.equal(fs.existsSync(path.join(run.runDir, '.magi-dispatches')), false);
  seal.profilesSha256 = 'a'.repeat(64); writeJson(file, seal);
  assert.throws(() => readSealedRun(run.runDir), /unsupported historical policy/);
});
