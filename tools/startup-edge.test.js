'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { createSealedRun, fakeVendor } = require('./test-fixtures.js');
const { sealPlan } = require('./plan-seal.js');
const { runDispatch } = require('./dispatch-run.js');

function snapshot(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) return [[file, 'directory'], ...snapshot(root, file)];
    return [[file, fs.readFileSync(path.join(root, file)).toString('base64')]];
  });
}

test('sealing cannot write inside a product worktree', t => {
  const run = createSealedRun(t);
  const before = snapshot(run.root);
  assert.throws(() => sealPlan({ plan: run.planSource, runDir: path.join(run.cwd, 'attempt'), availability: run.availability }), /overlap|outside.*product/);
  assert.deepEqual(snapshot(run.root), before);
});

test('known seal destination collisions do not leave a partial plan', t => {
  const run = createSealedRun(t);
  const runDir = path.join(run.root, 'occupied');
  fs.mkdirSync(runDir);
  fs.writeFileSync(path.join(runDir, 'availability.json'), 'existing bytes\n', 'utf8');
  const before = snapshot(run.root);
  assert.throws(() => sealPlan({ plan: run.planSource, runDir, availability: run.availability }), /already exists|occupied/);
  assert.deepEqual(snapshot(run.root), before);
});

test('ordinary Windows case aliases use the same plain worktree without changing plan bytes', t => {
  const run = createSealedRun(t);
  const plan = JSON.parse(fs.readFileSync(run.planSource, 'utf8'));
  if (process.platform === 'win32') plan.dispatches[0].cwd = plan.dispatches[0].cwd.toUpperCase();
  const original = JSON.stringify(plan);
  fs.writeFileSync(run.planSource, original, 'utf8');
  const runDir = path.join(run.root, 'alias-run');
  const result = sealPlan({ plan: run.planSource, runDir, availability: run.availability });
  assert.equal(fs.readFileSync(result.planPath, 'utf8'), original);
  assert.equal(fs.realpathSync.native(plan.dispatches[0].cwd), fs.realpathSync.native(run.cwd));
});

test('invalid plan seal options fail before a destination write', t => {
  const run = createSealedRun(t);
  for (const extra of [['--run-dir', path.join(run.root, 'second-run')], ['--availability', '--plan']]) {
    const runDir = path.join(run.root, 'unstarted');
    const before = snapshot(run.root);
    const result = spawnSync(process.execPath, [path.join(__dirname, 'plan-seal.js'), '--plan', run.planSource, '--run-dir', runDir, '--availability', run.availability, ...extra], { encoding: 'utf8', shell: false, windowsHide: true });
    assert.notEqual(result.status, 0);
    assert.deepEqual(snapshot(run.root), before);
  }
});

for (const kind of ['rules', 'skills', 'evidence']) {
  test(`invalid ${kind} startup leaves the unstarted entry available for correction`, async t => {
    const run = createSealedRun(t);
    const native = fakeVendor();
    const options = { ...run.opts, dispatchId: 'd1' };
    if (kind === 'rules') options.rulesRoot = path.join(run.root, 'missing-rules');
    if (kind === 'skills') options.skillSourceRoot = path.join(run.root, 'missing-skills');
    if (kind === 'evidence') {
      options.evidenceDir = path.join(run.runDir, 'occupied');
      fs.mkdirSync(options.evidenceDir);
      fs.writeFileSync(path.join(options.evidenceDir, 'keep.txt'), 'existing\n', 'utf8');
    }
    const before = snapshot(run.root);
    await assert.rejects(runDispatch(options, native), /missing|ENOENT|new or empty/);
    assert.equal(native.calls(), 0);
    assert.deepEqual(snapshot(run.root), before);
    const result = await runDispatch({ ...run.opts, dispatchId: 'd1' }, native);
    assert.equal(result.ok, true);
    assert.equal(native.calls(), 1);
  });
}

for (const kind of ['SKILL.md', 'VENDOR.md', 'RULES/INDEX.md', 'RULES/R22-fixture.md']) {
  test(`blank required ${kind} is rejected before reserving a dispatch`, async t => {
    const run = createSealedRun(t);
    const native = fakeVendor();
    const file = kind === 'SKILL.md'
      ? path.join(run.opts.skillSourceRoot, fs.readdirSync(run.opts.skillSourceRoot)[0], kind)
      : path.join(run.opts.rulesRoot, kind);
    const original = fs.readFileSync(file);
    for (const body of ['', '\ufeff \t\r\n']) {
      fs.writeFileSync(file, body, 'utf8');
      const before = snapshot(run.root);
      await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /empty|required.*content/);
      assert.equal(native.calls(), 0);
      assert.deepEqual(snapshot(run.root), before);
    }
    fs.writeFileSync(file, original);
    const result = await runDispatch({ ...run.opts, dispatchId: 'd1' }, native);
    assert.equal(result.ok, true);
    assert.equal(native.calls(), 1);
  });
}
