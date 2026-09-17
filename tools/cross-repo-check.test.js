// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { check, main } = require('./cross-repo-check.js');
const { loadProfiles } = require('./seat-policy.js');
const { FINGERPRINT, FINGERPRINT_V2 } = require('./cli-rules-stage.js');

function write(file, body) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body, 'utf8'); }
function json(file, value) { write(file, JSON.stringify(value, null, 2)); }
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-cross-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeRoot = path.join(root, 'runtime');
  const kitRoot = path.join(root, 'kit');
  const vaultRoot = path.join(root, 'rules');
  const profiles = loadProfiles();
  const profilePath = path.join(runtimeRoot, '.cursor/skills/conclave-cli/references/seat-profiles.json');
  json(profilePath, profiles);
  json(path.join(path.dirname(profilePath), 'dispatch-matrix.json'), { classes: Object.fromEntries(Object.keys(profiles.classSkills).map((name) => [name, {}])) });
  fs.mkdirSync(path.join(runtimeRoot, 'tools'), { recursive: true });
  const kit = { schemaVersion: 4, sharedStageSource: 'conclave/skills', baseSkills: profiles.baseSkills, roles: profiles.roleSkills, classes: profiles.classSkills, arbiterOnly: profiles.forbiddenSeatSkills };
  const kitPath = path.join(kitRoot, 'conclave/seat-skills.json');
  json(kitPath, kit);
  const skills = [...new Set([...Object.values(profiles.baseSkills).flat(), ...Object.values(profiles.roleSkills).flat(), ...Object.values(profiles.classSkills).flat()])];
  for (const skill of skills) {
    for (const base of [path.join(runtimeRoot, 'seat-skills'), path.join(kitRoot, 'conclave/skills')]) write(path.join(base, skill, 'SKILL.md'), `# ${skill}\nBound leaf skill.\n`);
  }
  const rules = Array.from({ length: 22 }, (_, i) => `R${String(i + 1).padStart(2, '0')}-fixture.md`);
  write(path.join(vaultRoot, 'STANDING.md'), `${FINGERPRINT_V2}\nBound BRIEF acknowledgment.\n`);
  write(path.join(vaultRoot, 'VENDOR.md'), 'openai codex; anthropic claude; google casper_via=agy\n');
  write(path.join(vaultRoot, 'RULES/INDEX.md'), rules.map((name) => `[${name.slice(0, 3)}](${name})`).join('\n'));
  for (const name of rules) write(path.join(vaultRoot, 'RULES', name), `# ${name}\nRule body.\n`);
  write(path.join(vaultRoot, 'BRIEF-RULES-BLOCK.md'), fs.readFileSync(path.join(__dirname, 'templates/brief-rules-block.md'), 'utf8'));
  return { root, runtimeRoot, kitRoot, vaultRoot, profiles, profilePath, kit, kitPath, skills, opts: { runtimeRoot, kitRoot, vaultRoot } };
}

test('matching explicit roots include exact v2 rules and identical lean skill files', (t) => {
  const f = fixture(t);
  const result = check(f.opts);
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert.ok(result.findings.some((entry) => entry.check === 'vault-R01-R22' && entry.ok));
  assert.ok(result.findings.some((entry) => entry.check === 'runtime-kit-skill-files' && entry.ok));
});

test('external roots must be explicit instead of falling back to a machine checkout', () => {
  assert.throws(() => check({ env: {} }), /CONCLAVE_KIT_ROOT|kit.root/i);
});

test('all vendor base cards must match the kit', (t) => {
  const f = fixture(t);
  f.kit.baseSkills = { ...f.kit.baseSkills, google: [] };
  json(f.kitPath, f.kit);
  const result = check(f.opts);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((entry) => entry.check === 'kit-base:google' && !entry.ok));
});

test('extra role or class keys cannot disappear from comparison', (t) => {
  for (const field of ['roles', 'classes']) {
    const f = fixture(t);
    f.kit[field] = { ...f.kit[field], invented: [] };
    json(f.kitPath, f.kit);
    assert.equal(check(f.opts).ok, false);
  }
});

test('duplicate skill names and asymmetric forbidden skills fail', (t) => {
  for (const change of ['duplicate', 'forbidden']) {
    const f = fixture(t);
    if (change === 'duplicate') f.kit.roles.implement.push('testing');
    else f.kit.arbiterOnly.push('invented-orchestrator');
    json(f.kitPath, f.kit);
    assert.equal(check(f.opts).ok, false);
  }
});

test('a forbidden skill in matching role maps still fails separation', (t) => {
  const f = fixture(t);
  f.profiles.roleSkills.review.push('conclave-mode');
  json(f.profilePath, f.profiles);
  f.kit.roles = f.profiles.roleSkills;
  json(f.kitPath, f.kit);
  assert.equal(check(f.opts).ok, false);
});

test('skill-name prose cannot replace an actual kit skill file', (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.kitRoot, 'conclave/skills', f.skills[0], 'SKILL.md'));
  assert.equal(check(f.opts).ok, false);
});

test('missing, changed, or extra bundled skill files fail the mirror check', (t) => {
  for (const mutation of ['missing', 'changed', 'extra', 'directory']) {
    const f = fixture(t);
    const file = path.join(f.runtimeRoot, 'seat-skills', f.skills[0], 'SKILL.md');
    if (mutation === 'missing' || mutation === 'directory') fs.unlinkSync(file);
    if (mutation === 'directory') fs.mkdirSync(file);
    if (mutation === 'changed') fs.appendFileSync(file, 'different\n', 'utf8');
    if (mutation === 'extra') write(path.join(f.runtimeRoot, 'seat-skills', 'conclave-mode', 'SKILL.md'), 'forbidden\n');
    assert.equal(check(f.opts).ok, false, mutation);
  }
});

test('kit sharedStageSource cannot escape the declared lean source', (t) => {
  const f = fixture(t);
  f.kit.sharedStageSource = '../../outside';
  json(f.kitPath, f.kit);
  assert.equal(check(f.opts).ok, false);
});

test('v1 is not accepted as the active cross-repository fingerprint', (t) => {
  const f = fixture(t);
  write(path.join(f.vaultRoot, 'STANDING.md'), `${FINGERPRINT}\n`);
  assert.equal(check(f.opts).ok, false);
});

test('exact R01-R22 inventory rejects missing, duplicate, and out-of-range IDs', (t) => {
  for (const mutation of ['missing', 'duplicate', 'out-of-range']) {
    const f = fixture(t);
    if (mutation !== 'duplicate') fs.unlinkSync(path.join(f.vaultRoot, 'RULES/R22-fixture.md'));
    if (mutation === 'duplicate') write(path.join(f.vaultRoot, 'RULES/R01-duplicate.md'), '# duplicate\n');
    if (mutation === 'out-of-range') write(path.join(f.vaultRoot, 'RULES/R23-fixture.md'), '# wrong rule\n');
    assert.equal(check(f.opts).ok, false, mutation);
  }
});

test('index must link every exact rule file once; mentions are insufficient', (t) => {
  const f = fixture(t);
  const index = path.join(f.vaultRoot, 'RULES/INDEX.md');
  write(index, fs.readFileSync(index, 'utf8').replace('[R22](R22-fixture.md)', 'R22-fixture.md'));
  assert.equal(check(f.opts).ok, false);
});

test('the versioned brief template must retain the leaf contract', (t) => {
  const f = fixture(t);
  write(path.join(f.vaultRoot, 'BRIEF-RULES-BLOCK.md'), 'SEAT-CONTRACT.md skills/skills-manifest.json\n');
  assert.equal(check(f.opts).ok, false);
});

test('CLI accepts explicit roots and rejects missing or unknown option values', (t) => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [path.join(__dirname, 'cross-repo-check.js'), '--kit-root', f.kitRoot, '--vault-root', f.vaultRoot, '--runtime-root', f.runtimeRoot], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).ok, true);
  for (const argv of [['--kit-root'], ['--unexpected', 'x']]) {
    const io = { stdout: { write() {} }, stderr: { write() {} } };
    assert.equal(main(argv, io), 2);
  }
});
