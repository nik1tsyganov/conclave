// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with section 7 terms; see LICENSE.
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { bindSkillSource, stageSeatSkills, verifySeatSkills, verifySkillSource } = require('./cli-skill-stage.js');
const { resolveRuntimePaths } = require('./runtime-paths.js');

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-skill-stage-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function put(file, body = '# skill\n') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
}
function fixture(t) {
  const root = temp(t);
  const source = path.join(root, 'source');
  const out = path.join(root, 'out');
  put(path.join(source, 'implement', 'SKILL.md'), '# implement\n');
  put(path.join(source, 'implement', 'references', 'guide.md'), '# reference\n');
  put(path.join(source, 'testing', 'SKILL.md'));
  put(path.join(source, 'engineering-orchestrator', 'SKILL.md'), 'forbidden');
  return { root, source, out, skills: ['implement', 'testing'] };
}
function stage(f) { return stageSeatSkills({ sourceRoot: f.source, destinationRoot: f.out, skills: f.skills }); }
function verify(f, staged) { return verifySeatSkills({ destinationRoot: f.out, skills: f.skills, manifest: staged.manifest }); }
function saveManifest(staged, manifest) { fs.writeFileSync(staged.manifestPath, JSON.stringify(manifest), 'utf8'); }
function rejects(f, staged) { assert.throws(() => verify(f, staged), { code: 'SKILL_VERIFY_FAIL' }); }

test('stages exactly allowed skills and verifies their original hashes', t => {
  const f = fixture(t);
  const staged = stage(f);
  assert.deepEqual(fs.readdirSync(f.out).sort(), ['implement', 'skills-manifest.json', 'testing']);
  assert.deepEqual(verify(f, staged), { ok: true, skills: f.skills });
  const body = fs.readFileSync(path.join(f.source, 'implement', 'SKILL.md'));
  const entry = staged.manifest.skills.implement.find(file => file.path === 'SKILL.md');
  assert.equal(entry.bytes, body.length);
  assert.equal(entry.sha256, crypto.createHash('sha256').update(body).digest('hex'));
});

test('source binding detects reference changes, additions and identical-content source substitution before staging', t => {
  const f = fixture(t);
  const binding = bindSkillSource({ sourceRoot: f.source, skills: f.skills });
  assert.deepEqual(verifySkillSource(binding), binding);
  const other = path.join(f.root, 'substitute'); fs.cpSync(f.source, other, { recursive: true });
  assert.throws(() => verifySkillSource(binding, other), /sealed identity or content/);
  assert.throws(() => stageSeatSkills({ sourceRoot: other, destinationRoot: f.out, skills: f.skills, sourceBinding: binding }), /sealed identity or content/);
  put(path.join(f.source, 'implement', 'references', 'guide.md'), 'changed reference');
  assert.throws(() => verifySkillSource(binding), /sealed identity or content/);
  assert.throws(() => stageSeatSkills({ sourceRoot: f.source, destinationRoot: f.out, skills: f.skills, sourceBinding: binding }), /sealed identity or content/);
  assert.equal(fs.existsSync(f.out), false);
});

test('default staging reads the runtime bundle', t => {
  const destinationRoot = path.join(temp(t), 'out');
  const staged = stageSeatSkills({ destinationRoot, skills: ['testing'] });
  const source = path.join(resolveRuntimePaths().seatSkillsRoot, 'testing', 'SKILL.md');
  assert.deepEqual(fs.readFileSync(path.join(destinationRoot, 'testing', 'SKILL.md')), fs.readFileSync(source));
  assert.equal(staged.manifest.sourceRoot, fs.realpathSync.native(resolveRuntimePaths().seatSkillsRoot));
  assert.equal(verifySeatSkills({ destinationRoot, skills: ['testing'], manifest: staged.manifest }).ok, true);
});

test('safe restaging replaces only a previously verified stage', t => {
  const f = fixture(t);
  stage(f);
  put(path.join(f.source, 'testing', 'SKILL.md'), 'updated');
  const staged = stage(f);
  assert.equal(fs.readFileSync(path.join(f.out, 'testing', 'SKILL.md'), 'utf8'), 'updated');
  assert.equal(verify(f, staged).ok, true);
});

test('missing required skill refuses before changing an existing stage', t => {
  const f = fixture(t);
  const staged = stage(f);
  f.skills.push('missing');
  assert.throws(() => stage(f), { code: 'SKILL_STAGE_FAIL' });
  f.skills.pop();
  assert.equal(verify(f, staged).ok, true);
});

test('missing SKILL.md refuses before creating a destination', t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.source, 'testing', 'SKILL.md'));
  assert.throws(() => stage(f), /missing SKILL\.md/);
  assert.equal(fs.existsSync(f.out), false);
});

test('forbidden and invalid skills fail closed', t => {
  const f = fixture(t);
  for (const skills of [[], ['magi-mode'], ['../testing'], ['testing/child'], [null]]) {
    assert.throws(() => stageSeatSkills({ sourceRoot: f.source, destinationRoot: f.out, skills }), { code: 'SKILL_STAGE_FAIL' });
  }
  assert.equal(fs.existsSync(f.out), false);
});

for (const relation of ['same', 'child', 'parent']) {
  test(`staging refuses ${relation} source overlap and preserves the source`, t => {
    const f = fixture(t);
    const destinations = { same: f.source, child: path.join(f.source, 'nested', 'out'), parent: f.root };
    assert.throws(() => stageSeatSkills({ sourceRoot: f.source, destinationRoot: destinations[relation], skills: f.skills }), /overlap/);
    assert.equal(fs.readFileSync(path.join(f.source, 'implement', 'SKILL.md'), 'utf8'), '# implement\n');
    assert.equal(fs.existsSync(path.join(f.source, 'nested')), false);
  });
}

test('unrelated destination and added stage entries survive refused replacement', t => {
  const f = fixture(t);
  put(path.join(f.out, 'sentinel'), 'keep');
  assert.throws(() => stage(f), /unrelated/);
  assert.equal(fs.readFileSync(path.join(f.out, 'sentinel'), 'utf8'), 'keep');
  fs.unlinkSync(path.join(f.out, 'sentinel'));
  stage(f);
  fs.mkdirSync(path.join(f.out, 'testing', 'empty'));
  assert.throws(() => stage(f), /directory set mismatch/);
  assert.equal(fs.existsSync(path.join(f.out, 'testing', 'empty')), true);
});

for (const [name, mutate] of Object.entries({
  'file contents': f => put(path.join(f.out, 'testing', 'SKILL.md'), 'changed'),
  'added file': f => put(path.join(f.out, 'testing', 'extra.md')),
  'empty skill directory': f => fs.mkdirSync(path.join(f.out, 'testing', 'empty')),
  'empty root directory': f => fs.mkdirSync(path.join(f.out, 'extra')),
  'missing skill file': f => fs.unlinkSync(path.join(f.out, 'testing', 'SKILL.md')),
  'manifest timestamp': (f, m) => { m.generatedAt = '2000-01-01T00:00:00.000Z'; },
  'manifest source root': (f, m) => { m.sourceRoot = f.root; },
  'manifest extra metadata': (f, m) => { m.trusted = true; },
  'manifest hash': (f, m) => { m.skills.testing[0].sha256 = '0'.repeat(64); },
  'manifest entry metadata': (f, m) => { m.skills.testing[0].allowed = true; },
  'forged content and manifest': (f, m) => {
    const body = Buffer.from('forged');
    put(path.join(f.out, 'testing', 'SKILL.md'), body);
    m.skills.testing[0].bytes = body.length;
    m.skills.testing[0].sha256 = crypto.createHash('sha256').update(body).digest('hex');
  },
})) {
  test(`verification rejects ${name}`, t => {
    const f = fixture(t);
    const staged = stage(f);
    const disk = structuredClone(staged.manifest);
    mutate(f, disk);
    saveManifest(staged, disk);
    rejects(f, staged);
  });
}

for (const unsafe of ['../outside', '/absolute', 'C:/absolute', 'ref\\file', 'SKILL.md:stream', './SKILL.md', 'refs//file', 'refs/../file', 'file.', 'file ', 'NUL.txt']) {
  test(`verification rejects unsafe trusted manifest path ${JSON.stringify(unsafe)}`, t => {
    const f = fixture(t);
    const staged = stage(f);
    staged.manifest.skills.testing.push({ ...staged.manifest.skills.testing[0], path: unsafe });
    saveManifest(staged, staged.manifest);
    rejects(f, staged);
  });
}

test('verification rejects case aliases, invalid byte counts, and missing SKILL.md in the trusted manifest', t => {
  const f = fixture(t);
  const staged = stage(f);
  const original = structuredClone(staged.manifest);
  for (const mutate of [
    m => m.skills.testing.push({ ...m.skills.testing[0], path: 'skill.md' }),
    m => { m.skills.testing[0].bytes = -1; },
    m => { m.skills.testing[0].bytes = 1.5; },
    m => { m.skills.testing[0].path = 'other.md'; },
  ]) {
    staged.manifest = structuredClone(original);
    mutate(staged.manifest);
    saveManifest(staged, staged.manifest);
    rejects(f, staged);
  }
});

for (const place of ['root', 'ancestor', 'skill', 'nested']) {
  test(`verification rejects a junction at the ${place}`, t => {
    const f = fixture(t);
    const staged = stage(f);
    if (place === 'root' || place === 'ancestor') {
      const link = path.join(f.root, 'link');
      fs.symlinkSync(place === 'root' ? f.out : f.root, link, 'junction');
      f.out = place === 'root' ? link : path.join(link, 'out');
    } else if (place === 'skill') {
      const dir = path.join(f.out, 'testing');
      const moved = path.join(f.root, 'moved-testing');
      assert.equal(path.dirname(moved), f.root);
      fs.renameSync(dir, moved);
      fs.symlinkSync(moved, dir, 'junction');
    } else fs.symlinkSync(f.source, path.join(f.out, 'testing', 'link'), 'junction');
    rejects(f, staged);
  });
}

test('staging refuses source and destination junctions without touching their targets', t => {
  const f = fixture(t);
  const link = path.join(f.root, 'source-link');
  fs.symlinkSync(f.source, link, 'junction');
  assert.throws(() => stageSeatSkills({ sourceRoot: link, destinationRoot: f.out, skills: f.skills }), /symlink|junction/);
  fs.symlinkSync(f.source, f.out, 'junction');
  assert.throws(() => stage(f), /symlink|junction/);
  assert.equal(fs.readFileSync(path.join(f.source, 'implement', 'SKILL.md'), 'utf8'), '# implement\n');
});
