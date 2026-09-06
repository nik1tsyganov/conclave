'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');
const test = require('node:test');
const { check, main } = require('./magi-cli-preflight.js');
const { FINGERPRINT, FINGERPRINT_V2 } = require('./cli-rules-stage.js');
const { CLI_RUNTIME_TOOLS } = require('./runtime-paths.js');

function put(file, body = 'fixture\n') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-preflight-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const runtimeRoot = path.join(root, 'runtime');
  const rulesRoot = path.join(root, 'rules');
  const home = path.join(root, 'home');
  const references = path.join(runtimeRoot, 'skills', 'magi-cli', 'references');
  const seatProfiles = path.join(references, 'seat-profiles.json');
  const profiles = { arbiterSkills: ['magi-mode'], forbiddenSeatSkills: ['magi-mode'],
    baseSkills: { openai: ['seat-openai'] }, roleSkills: { verify: ['testing'] }, classSkills: {} };
  put(seatProfiles, JSON.stringify(profiles));
  put(path.join(references, 'dispatch-matrix.json'), '{}');
  fs.mkdirSync(path.join(runtimeRoot, 'tools'));
  for (const name of CLI_RUNTIME_TOOLS) put(path.join(runtimeRoot, 'tools', name));
  for (const skill of ['seat-openai', 'testing']) put(path.join(runtimeRoot, 'seat-skills', skill, 'SKILL.md'), 'lean bundled skill');
  put(path.join(home, '.claude', 'skills', 'testing', 'SKILL.md'), 'wrong full home skill');
  put(path.join(rulesRoot, 'STANDING.md'), FINGERPRINT_V2 + '\n');
  put(path.join(rulesRoot, 'VENDOR.md'));
  put(path.join(rulesRoot, 'RULES', 'INDEX.md'));
  for (let n = 1; n <= 22; n += 1) put(path.join(rulesRoot, 'RULES', `R${String(n).padStart(2, '0')}-fixture.md`));
  const env = {};
  for (const name of ['MAGI_CODEX_BIN', 'MAGI_AGY_BIN', 'MAGI_CLAUDE_BIN']) {
    env[name] = path.join(root, 'binaries', `${name}.bin`);
    put(env[name], 'not executable; existence check only');
  }
  return { root, runtimeRoot, rulesRoot, home, env, seatProfiles, profiles };
}
function snapshot(root) {
  const entries = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) entries.push([path.relative(root, full), 'link', fs.readlinkSync(full)]);
      else if (entry.isDirectory()) { entries.push([path.relative(root, full), 'dir']); walk(full); }
      else entries.push([path.relative(root, full), fs.readFileSync(full).toString('base64')]);
    }
  }
  walk(root);
  return entries;
}

test('preflight uses bundled skills and v2 rules with file-only binary discovery', t => {
  const f = fixture(t);
  const before = snapshot(f.root);
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    t.mock.method(child, name, () => { throw new Error('preflight must not launch native processes'); });
  }
  const result = check(f);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.arbiterSkills, ['magi-mode']);
  assert.equal(result.findings.some(row => row.check.startsWith('arbiter-skill:')), false);
  const canonicalRuntimeRoot = fs.realpathSync.native(f.runtimeRoot);
  assert.ok(result.findings.filter(row => row.check.startsWith('seat-skill:')).every(row => row.value.startsWith(canonicalRuntimeRoot + path.sep)));
  assert.deepEqual(result.findings.find(row => row.check === 'rules:R01-R22').observed, Array.from({ length: 22 }, (_, n) => `R${String(n + 1).padStart(2, '0')}`));
  assert.deepEqual(snapshot(f.root), before);
});

test('missing external rules root reports MAGI_RULES_ROOT instead of throwing', t => {
  const f = fixture(t);
  delete f.rulesRoot;
  const result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'rules:root').error, /MAGI_RULES_ROOT/);
});

test('explicit environment rules root is supported', t => {
  const f = fixture(t);
  f.env.MAGI_RULES_ROOT = f.rulesRoot;
  delete f.rulesRoot;
  assert.equal(check(f).ok, true);
});

for (const relative of ['STANDING.md', 'VENDOR.md', 'RULES/INDEX.md', 'RULES/R01-fixture.md', 'RULES/R22-fixture.md']) {
  test(`missing ${relative} fails preflight`, t => {
    const f = fixture(t);
    fs.unlinkSync(path.join(f.rulesRoot, relative));
    assert.equal(check(f).ok, false);
  });
}

test('v1 rules and duplicate rule IDs cannot pass production preflight', t => {
  const f = fixture(t);
  put(path.join(f.rulesRoot, 'STANDING.md'), FINGERPRINT + '\n');
  assert.equal(check(f).ok, false);
  put(path.join(f.rulesRoot, 'STANDING.md'), FINGERPRINT_V2 + '\n');
  put(path.join(f.rulesRoot, 'RULES', 'R22-duplicate.md'));
  const result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'rules:R01-R22').error, /duplicate.*R22/);
});

test('home skill cannot replace a missing bundled skill or a SKILL.md directory', t => {
  const f = fixture(t);
  const file = path.join(f.runtimeRoot, 'seat-skills', 'testing', 'SKILL.md');
  fs.unlinkSync(file);
  assert.equal(check(f).ok, false);
  fs.mkdirSync(file);
  assert.equal(check(f).ok, false);
});

test('forbidden and unsafe profile skills fail preflight', t => {
  const f = fixture(t);
  for (const name of ['magi-mode', '../testing']) {
    f.profiles.roleSkills.verify = [name];
    put(f.seatProfiles, JSON.stringify(f.profiles));
    assert.equal(check(f).ok, false);
  }
});

test('bundled skill and external rules junctions fail without writes', t => {
  const f = fixture(t);
  const skill = path.join(f.runtimeRoot, 'seat-skills', 'testing');
  const moved = path.join(f.root, 'testing');
  assert.equal(path.dirname(moved), f.root);
  fs.renameSync(skill, moved);
  fs.symlinkSync(moved, skill, 'junction');
  const link = path.join(f.root, 'rules-link');
  fs.symlinkSync(f.rulesRoot, link, 'junction');
  f.rulesRoot = link;
  const before = snapshot(f.root);
  const result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'rules:root').error, /junction|symlink/);
  assert.match(result.findings.find(row => row.check === 'seat-skill:testing').error, /junction|symlink/);
  assert.deepEqual(snapshot(f.root), before);
});

test('rule directories cannot count as required rule files', t => {
  const f = fixture(t);
  const file = path.join(f.rulesRoot, 'RULES', 'R22-fixture.md');
  fs.unlinkSync(file);
  fs.mkdirSync(file);
  const result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'rules:R01-R22').error, /regular file/);
});

test('CLI rejects missing or unknown options with a structured result', () => {
  for (const args of [['--rules-root'], ['--unknown']]) {
    let output = '';
    const status = main(args, { stdout: { write: text => { output += text; } } });
    assert.equal(status, 2);
    assert.equal(JSON.parse(output).ok, false);
  }
});

test('an incomplete runtime cannot pass startup preflight', t => {
  const f = fixture(t);
  fs.rmSync(path.join(f.runtimeRoot, 'tools', 'plan-seal.js'), { force: true });
  const before = snapshot(f.root);
  const result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'runtime:files').error, /plan-seal\.js/);
  assert.deepEqual(snapshot(f.root), before);
});

test('v2 preflight rejects an additional rule ID', t => {
  const f = fixture(t);
  put(path.join(f.rulesRoot, 'RULES', 'R23-extra.md'));
  const result = check(f);
  assert.equal(result.ok, false);
  assert.match(result.findings.find(row => row.check === 'rules:R01-R22').error, /exactly R01-R22/);
});

for (const relative of ['SKILL.md', 'STANDING.md', 'VENDOR.md', 'RULES/INDEX.md', 'RULES/R01-fixture.md', 'RULES/R22-fixture.md']) {
  test(`blank required ${relative} fails preflight without writes`, t => {
    const f = fixture(t);
    const file = relative === 'SKILL.md'
      ? path.join(f.runtimeRoot, 'seat-skills', 'testing', relative)
      : path.join(f.rulesRoot, relative);
    const original = fs.readFileSync(file);
    for (const body of ['', '\ufeff \t\r\n']) {
      fs.writeFileSync(file, body, 'utf8');
      const before = snapshot(f.root);
      assert.equal(check(f).ok, false);
      assert.deepEqual(snapshot(f.root), before);
    }
    fs.writeFileSync(file, original);
    assert.equal(check(f).ok, true);
  });
}
