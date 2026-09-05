'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { stageSeatSkills } = require('./cli-skill-stage.js');

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'magi-skill-stage-')); }
function makeSkill(root, name, body = '# skill\n') {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), body, 'utf8');
  return dir;
}

test('stages only the requested allow-listed skills and writes hashes', () => {
  const root = temp();
  const source = path.join(root, 'source');
  const out = path.join(root, 'out');
  makeSkill(source, 'implement', '# implement\n');
  makeSkill(source, 'testing', '# testing\n');
  makeSkill(source, 'engineering-orchestrator', '# forbidden global\n');
  const staged = stageSeatSkills({ skills: ['implement', 'testing'], sourceRoot: source, destinationRoot: out });
  assert.ok(fs.existsSync(path.join(out, 'implement', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(out, 'testing', 'SKILL.md')));
  assert.ok(!fs.existsSync(path.join(out, 'engineering-orchestrator')));
  const manifest = JSON.parse(fs.readFileSync(staged.manifestPath, 'utf8'));
  assert.deepStrictEqual(Object.keys(manifest.skills).sort(), ['implement', 'testing']);
  assert.match(manifest.skills.implement[0].sha256, /^[a-f0-9]{64}$/);
});

test('fails closed when an allowed skill is missing SKILL.md', () => {
  const root = temp();
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'implement'), { recursive: true });
  assert.throws(
    () => stageSeatSkills({ skills: ['implement'], sourceRoot: source, destinationRoot: path.join(root, 'out') }),
    (error) => error.code === 'SKILL_STAGE_FAIL' && /missing SKILL\.md/.test(error.message),
  );
});

test('rejects symlinks inside a staged skill', { skip: process.platform === 'win32' }, () => {
  const root = temp();
  const source = path.join(root, 'source');
  const skill = makeSkill(source, 'implement');
  fs.symlinkSync(path.join(skill, 'SKILL.md'), path.join(skill, 'link.md'));
  assert.throws(
    () => stageSeatSkills({ skills: ['implement'], sourceRoot: source, destinationRoot: path.join(root, 'out') }),
    (error) => error.code === 'SKILL_STAGE_FAIL' && /symlink forbidden/.test(error.message),
  );
});
