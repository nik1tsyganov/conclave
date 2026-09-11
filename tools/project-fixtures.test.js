'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { PROJECT_IDS, generateFixture } = require('./project-fixtures');

function runTests(fixture, args) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, args, { cwd: fixture.root, env, encoding: 'utf8', timeout: 20000 });
}

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-project-fixtures-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('two reproducible projects have exactly two writable modules and eleven files', t => {
  const root = temporary(t);
  assert.deepEqual(PROJECT_IDS, ['ticket-digest', 'workshop-roster']);
  for (const project of PROJECT_IDS) {
    const left = generateFixture(project, path.join(root, project + '-a'));
    const right = generateFixture(project, path.join(root, project + '-b'));
    assert.deepEqual(left.files, right.files);
    assert.equal(left.files.length, 11);
    assert.equal(left.units.length, 2);
    assert.equal(left.files.filter(file => !file.protected).length, 2);
    assert.deepEqual(fs.readdirSync(left.root, { recursive: true }).filter(relative => fs.statSync(path.join(left.root, relative)).isFile()).map(relative => relative.replaceAll('\\', '/')).sort(), left.files.map(file => file.path).sort());
    for (const unit of left.units) {
      assert.equal(unit.writeScope.length, 1);
      assert.ok(unit.writeScope[0].startsWith('src/'));
      assert.ok(left.files.find(file => file.path === unit.writeScope[0] && !file.protected));
    }
    for (const file of left.files) {
      const bytes = fs.readFileSync(path.join(left.root, file.path));
      assert.deepEqual(bytes, fs.readFileSync(path.join(right.root, file.path)));
      assert.equal(bytes.length, file.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    }
    assert.equal(JSON.parse(fs.readFileSync(path.join(left.root, 'package.json'))).dependencies, undefined);
  }
});
for (const project of ['ticket-digest', 'workshop-roster']) {
  test(project + ' runs each unit and integration baseline with only the declared failures', t => {
    const fixture = generateFixture(project, path.join(temporary(t), project));
    const before = fixture.files.map(file => fs.readFileSync(path.join(fixture.root, file.path)));
    for (const check of [...fixture.units, fixture.integration]) {
      const run = runTests(fixture, check.testArgs);
      assert.ifError(run.error);
      assert.equal(run.status, 1, run.stdout + run.stderr);
      const failed = [...run.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]);
      assert.deepEqual(failed.sort(), [...check.baselineFailures].sort(), run.stdout + run.stderr);
      assert.equal([...run.stdout.matchAll(/code: 'ERR_ASSERTION'/g)].length, failed.length, run.stdout + run.stderr);
      assert.doesNotMatch(run.stdout + run.stderr, /SyntaxError|MODULE_NOT_FOUND/);
    }
    const full = runTests(fixture, fixture.testArgs);
    assert.ifError(full.error);
    assert.equal(full.status, 1);
    const allFailures = [...full.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]);
    assert.deepEqual(allFailures.sort(), [...fixture.units, fixture.integration].flatMap(check => check.baselineFailures).sort());
    assert.deepEqual(fixture.files.map(file => fs.readFileSync(path.join(fixture.root, file.path))), before);
  });
}

test('generator refuses unknown projects and existing destinations without changing them', t => {
  const root = temporary(t);
  assert.throws(() => generateFixture('unknown', path.join(root, 'new')), /Unknown project/);
  assert.equal(fs.existsSync(path.join(root, 'new')), false);
  assert.throws(() => generateFixture('ticket-digest', 'relative'), /absolute/);
  fs.writeFileSync(path.join(root, 'keep'), 'unchanged');
  assert.throws(() => generateFixture('ticket-digest', root), /exist/i);
  assert.equal(fs.readFileSync(path.join(root, 'keep'), 'utf8'), 'unchanged');
});
