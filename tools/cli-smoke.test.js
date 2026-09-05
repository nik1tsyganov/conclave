'use strict';

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { assertGooglePlan, assertNoBodyLeak, assertOpenaiPlan, googlePlanHasSkillsAddDir, main } = require('./cli-smoke.js');
const { buildSeatProfile, loadProfiles } = require('./seat-policy.js');
const { stageSeatSkills } = require('./cli-skill-stage.js');

const ROOT = path.resolve(__dirname, '..');
const smokePath = path.join(__dirname, 'cli-smoke.js');

function uniqueBody() {
  return `RULES/INDEX.md SEAT-CONTRACT.md skills/skills-manifest.json WRITE AUDIT\nUNIQUE-SMOKE-${crypto.randomUUID()}-`.padEnd(200, 'b');
}

function makeBrief(t, body) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-smoke-'));
  const briefPath = path.join(directory, 'BRIEF.md');
  fs.writeFileSync(briefPath, body, 'utf8');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return briefPath;
}

function stagedBrief(t) {
  const briefPath = makeBrief(t, uniqueBody());
  const root = path.dirname(briefPath);
  const profile = buildSeatProfile(loadProfiles(), { vendor: 'openai', role: 'review', class: 'review-adversarial' });
  const sourceRoot = path.join(root, 'source');
  for (const skill of profile.skills) {
    fs.mkdirSync(path.join(sourceRoot, skill), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, skill, 'SKILL.md'), `# ${skill}\nRead-only diagnostic fixture.\n`, 'utf8');
  }
  const staged = stageSeatSkills({ skills: profile.skills, sourceRoot, destinationRoot: path.join(root, 'skills') });
  fs.writeFileSync(path.join(root, 'seat-profile.json'), JSON.stringify(profile), 'utf8');
  const seatContractPath = path.join(root, 'SEAT-CONTRACT.md');
  fs.writeFileSync(seatContractPath, [
    '# MAGI CLI seat contract', 'Vendor: openai', 'Role: review', 'Class: review-adversarial',
    `Permission profile: ${profile.permissionProfile}`,
    'Read-only leaf seat.',
    'Allowed staged skills:',
    ...profile.skills.map((skill) => `- ${skill}: ${path.join(staged.root, skill, 'SKILL.md')}`),
    '', `Skill manifest: ${staged.manifestPath}`,
  ].join('\n'), 'utf8');
  return { briefPath, root, profile, staged, seatContractPath };
}

function capture() {
  const io = { stdoutText: '', stderrText: '' };
  io.stdout = { write(chunk) { io.stdoutText += chunk; } };
  io.stderr = { write(chunk) { io.stderrText += chunk; } };
  return io;
}

test('offline smoke checks current adapters with every child-process API forbidden', (t) => {
  const fixture = stagedBrief(t);
  assert.strictEqual(fs.readFileSync(fixture.briefPath, 'utf8').length, 200);
  const noSpawn = path.join(fixture.root, 'no-spawn.cjs');
  fs.writeFileSync(noSpawn, [
    "const cp = require('node:child_process');",
    "for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {",
    "  cp[name] = () => { throw new Error('unexpected child-process API: ' + name); };",
    '}',
  ].join('\n'), 'utf8');
  const result = spawnSync(process.execPath, ['--require', noSpawn, smokePath, '--brief', fixture.briefPath, '--cwd', fixture.root], {
    encoding: 'utf8', env: { ...process.env, MAGI_ALLOWED_WORKSPACE_ROOTS: fixture.root }, windowsHide: true,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepStrictEqual(report.vendors, ['openai', 'google', 'anthropic']);
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.dryRun, true);
  assert.strictEqual(report.diagnostic, 'pointer-delivery-only');
  assert.strictEqual(report.activationEligible, false);
});

test('the CLI accepts an explicit staged contract outside the brief directory', (t) => {
  const fixture = stagedBrief(t);
  const nested = path.join(fixture.root, 'brief');
  fs.mkdirSync(nested);
  const briefPath = path.join(nested, 'BRIEF.md');
  fs.copyFileSync(fixture.briefPath, briefPath);
  const result = spawnSync(process.execPath, [
    smokePath, '--brief', briefPath, '--cwd', fixture.root,
    '--skill-root', fixture.staged.root, '--seat-contract', fixture.seatContractPath,
  ], { encoding: 'utf8', env: { ...process.env, MAGI_ALLOWED_WORKSPACE_ROOTS: fixture.root }, windowsHide: true });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(JSON.parse(result.stdout).activationEligible, false);
});

test('offline smoke still rejects a workspace outside its explicit grant', (t) => {
  const fixture = stagedBrief(t);
  const allowedRoot = path.join(fixture.root, 'allowed');
  const result = spawnSync(process.execPath, [smokePath, '--brief', fixture.briefPath, '--cwd', fixture.root], {
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, MAGI_DEV_ROOT: allowedRoot, MAGI_ALLOWED_WORKSPACE_ROOTS: allowedRoot },
  });
  assert.strictEqual(result.status, 1, result.stdout);
  assert.match(result.stderr, /WORKSPACE_FORBIDDEN/);
  assert.strictEqual(fs.existsSync(`${fixture.briefPath}.pointer.md`), false);
});

test('empty, missing, and omitted briefs are argument errors', async (t) => {
  for (const args of [
    ['--brief', makeBrief(t, ''), '--cwd', ROOT],
    ['--brief', path.join(os.tmpdir(), 'magi-smoke-no-such-brief.md'), '--cwd', ROOT],
    ['--cwd', ROOT],
  ]) {
    const io = capture();
    assert.strictEqual(await main(args, io), 2, io.stderrText);
    assert.match(io.stderrText, /^ARGUMENT_ERROR:/);
  }
});

test('missing basic markers fail before launch planning', async (t) => {
  const io = capture();
  const briefPath = makeBrief(t, 'unbound task');
  const code = await main(['--brief', briefPath, '--cwd', ROOT], io);
  assert.strictEqual(code, 1);
  assert.strictEqual(fs.existsSync(`${briefPath}.pointer.md`), false);
  for (const marker of ['RULES/INDEX|magi-cli-rules|STANDING', 'SEAT-CONTRACT', 'skills-manifest', 'WRITE AUDIT|R07']) {
    assert.ok(io.stderrText.includes(marker));
  }
});

test('marker words alone cannot supply the staged skill root or contract', async (t) => {
  const io = capture();
  const result = await main(['--brief', makeBrief(t, uniqueBody()), '--cwd', ROOT], io);
  assert.strictEqual(result, 1);
  assert.match(io.stderrText, /seat-profile|staged seat|contract/);
});

test('a modified staged skill fails the diagnostic', async (t) => {
  const fixture = stagedBrief(t);
  fs.appendFileSync(path.join(fixture.staged.root, fixture.profile.skills[0], 'SKILL.md'), 'changed\n', 'utf8');
  const io = capture();
  assert.strictEqual(await main(['--brief', fixture.briefPath, '--cwd', ROOT], io), 1);
  assert.match(io.stderrText, /hash|mismatch|bytes/);
});

test('a plan argument carrying the brief body is a leak', () => {
  const body = uniqueBody();
  assert.throws(() => assertNoBodyLeak('google', { args: ['-p', body] }, body), /leaks the brief body into an argument/);
});

test('stdin-file contents carrying the brief body are a leak', (t) => {
  const body = uniqueBody();
  const briefPath = makeBrief(t, body);
  const stdinFile = `${briefPath}.stdin.md`;
  fs.writeFileSync(stdinFile, `prefix ${body} suffix`, 'utf8');
  assert.throws(() => assertNoBodyLeak('openai', { args: [], stdinFile }, body), /leaks the brief body/);
});

test('OpenAI rejects inline delivery and piping the brief itself', () => {
  const briefPath = path.join(ROOT, 'example-brief.md');
  assert.throws(() => assertOpenaiPlan({ delivery: 'inline', stdinFile: 'other.md' }, briefPath), /expected "pointer"/);
  assert.throws(() => assertOpenaiPlan({ delivery: 'pointer', stdinFile: briefPath }, briefPath), /brief path itself/);
});

test('Google rejects a body prompt and accepts the exact staged skill directory', () => {
  const body = uniqueBody();
  const skillRoot = path.join(ROOT, 'example-run', 'skills');
  assert.throws(() => assertGooglePlan({ args: ['-p', body] }, body, skillRoot), /-p value is the brief body/);
  assertGooglePlan({ args: ['--add-dir', skillRoot, '-p', 'Read the bound BRIEF.md in full.'] }, body, skillRoot);
  assert.strictEqual(googlePlanHasSkillsAddDir(['--add-dir', skillRoot], skillRoot), true);
});

test('Google rejects absent, broader home, and similarly named skill grants', () => {
  const body = uniqueBody();
  const skillRoot = path.join(ROOT, 'example-run', 'skills');
  for (const addDir of [null, path.join(os.homedir(), '.claude', 'skills'), `${skillRoot}-other`, path.dirname(skillRoot)]) {
    const args = [...(addDir ? ['--add-dir', addDir] : []), '-p', 'Read the bound BRIEF.md in full.'];
    assert.throws(() => assertGooglePlan({ args }, body, skillRoot), /missing --add-dir/);
  }
  assert.strictEqual(googlePlanHasSkillsAddDir(['--add-dir', skillRoot]), false);
});
