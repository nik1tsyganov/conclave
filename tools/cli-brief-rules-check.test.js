'use strict';

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { checkBriefFile, checkBriefText, formatMissing, main, missingMarkers } = require('./cli-brief-rules-check.js');
const { FINGERPRINT, stageRules } = require('./cli-rules-stage.js');
const { stageSeatSkills } = require('./cli-skill-stage.js');
const { buildSeatProfile, loadProfiles } = require('./seat-policy.js');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATHS = [
  path.join(ROOT, '.cursor', 'skills', 'magi', 'references', 'brief-rules-block.md'),
  path.join(ROOT, '.cursor', 'skills', 'magi-cli', 'references', 'brief-rules-block.md'),
  path.join(ROOT, 'tools', 'templates', 'brief-rules-block.md'),
];
const ALL_MARKER_IDS = [
  'RULES/INDEX|magi-cli-rules|STANDING', 'SEAT-CONTRACT', 'skills-manifest', 'WRITE AUDIT|R07',
];
const V2_FINGERPRINT = 'MAGI-CLI-STANDING v2 — Read this file and RULES/INDEX.md in full before task work.';

function legalBrief({ role = 'implement', vendor = 'openai' } = {}) {
  return [
    'BOUND-BRIEF-ACK',
    'Read STANDING.md and RULES/INDEX.md. Delivery: pointer-only.',
    'Read SEAT-CONTRACT.md and skills/skills-manifest.json. Use only the allowed files.',
    'SCOPE: src/example.js and its existing tests.',
    role === 'implement' ? 'ROLE: implement. WRITE AUDIT (R07).' : `ROLE: ${role}. Read-only; do not modify product files. R07.`,
    'hostMode: cursor-cli. Leaf policy: leaf seat; no fan-out.',
    vendor === 'google' ? 'Vendor: agy. casper_via=agy.' : `Vendor: ${vendor}.`,
    vendor === 'anthropic' ? 'R16 auth and headless probe status checked by the arbiter.' : '',
    'Runtime-owned receipt ACK, handoff envelope, telemetry R17, and R18 vendor-native proof.',
    'SLICES not vendors (R11). not CONCLAVE. No C:\\src\\vault writes (R21).',
  ].join('\n');
}

function makeBrief(t, body) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-brief-rules-'));
  const briefPath = path.join(directory, 'BRIEF.md');
  fs.writeFileSync(briefPath, body, 'utf8');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return briefPath;
}

function stagedBrief(t, { role = 'implement', vendor = 'openai', v2 = false } = {}) {
  const briefPath = makeBrief(t, legalBrief({ role, vendor }));
  const root = path.dirname(briefPath);
  const rulesRoot = path.join(root, 'source-rules');
  fs.mkdirSync(path.join(rulesRoot, 'RULES'), { recursive: true });
  const fingerprint = v2 ? V2_FINGERPRINT : FINGERPRINT;
  fs.writeFileSync(path.join(rulesRoot, 'STANDING.md'), `${fingerprint}\nRead the rule pack.\n`, 'utf8');
  fs.writeFileSync(path.join(rulesRoot, 'VENDOR.md'), 'openai: codex; anthropic: claude; google: casper_via=agy\n', 'utf8');
  const files = Array.from({ length: v2 ? 22 : 21 }, (_, i) => `R${String(i + 1).padStart(2, '0')}-fixture.md`);
  fs.writeFileSync(path.join(rulesRoot, 'RULES', 'INDEX.md'), files.join('\n'), 'utf8');
  for (const file of files) fs.writeFileSync(path.join(rulesRoot, 'RULES', file), `# ${file}\nFixture rule.\n`, 'utf8');
  const staged = stageRules({ briefPath, rulesRoot });
  const seatProfile = buildSeatProfile(loadProfiles(), { vendor, role, class: 'standard-feature' });
  const sourceRoot = path.join(root, 'source-skills');
  for (const skill of seatProfile.skills) {
    fs.mkdirSync(path.join(sourceRoot, skill), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, skill, 'SKILL.md'), `# ${skill}\nBound leaf skill.\n`, 'utf8');
  }
  const skillStage = stageSeatSkills({ skills: seatProfile.skills, sourceRoot, destinationRoot: path.join(root, 'skills') });
  const seatContractPath = path.join(root, 'SEAT-CONTRACT.md');
  fs.writeFileSync(seatContractPath, [
    '# MAGI CLI seat contract',
    `Vendor: ${vendor}`, `Role: ${role}`, `Class: ${seatProfile.class}`,
    `Permission profile: ${seatProfile.permissionProfile}`,
    'This is a leaf seat. Do not sub-dispatch.',
    'Allowed staged skills:',
    ...seatProfile.skills.map((skill) => `- ${skill}: ${path.join(skillStage.root, skill, 'SKILL.md')}`),
    '', `Skill manifest: ${skillStage.manifestPath}`,
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(root, 'seat-profile.json'), JSON.stringify(seatProfile), 'utf8');
  return {
    briefPath, root, seatProfile, skillStage,
    opts: {
      role, vendor, requireStructural: true, seatProfile, skillRoot: skillStage.root, seatContractPath,
      expectedRulesManifest: staged.manifest, expectedSkillsManifest: skillStage.manifest,
    },
  };
}

function capture() {
  const io = { stdoutText: '', stderrText: '' };
  io.stdout = { write(chunk) { io.stdoutText += chunk; } };
  io.stderr = { write(chunk) { io.stderrText += chunk; } };
  return io;
}

test('a leaf brief passes without naming orchestration or bridge skills', () => {
  assert.deepStrictEqual(checkBriefText(legalBrief()), { ok: true, missing: [] });
});

for (const [needle, id] of [
  ['Read STANDING.md and RULES/INDEX.md.', ALL_MARKER_IDS[0]],
  ['SEAT-CONTRACT.md', 'SEAT-CONTRACT'],
  ['skills/skills-manifest.json', 'skills-manifest'],
  ['WRITE AUDIT (R07)', 'WRITE AUDIT|R07'],
]) {
  test(`missing ${id} is listed`, () => {
    assert.deepStrictEqual(checkBriefText(legalBrief().replace(needle, '')), { ok: false, missing: [id] });
  });
}

test('pack aliases and R07 remain supported by the basic marker check', () => {
  for (const pack of ['STANDING.md', 'RULES\\INDEX.md', 'magi-cli-rules']) {
    const body = legalBrief().replace('STANDING.md and RULES/INDEX.md', pack).replace('WRITE AUDIT (R07)', 'R07');
    assert.deepStrictEqual(checkBriefText(body), { ok: true, missing: [] });
  }
});

test('Google requires its exact agy transport marker in strict briefs', () => {
  const body = legalBrief({ vendor: 'google' });
  for (const substitute of ['Vendor: agy', 'gemini', 'not-agy']) {
    const result = checkBriefText(body.replace('casper_via=agy', substitute), { vendor: 'google', requireStructural: true });
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.includes('casper_via=agy'));
  }
});

test('Claude strict briefs require the R16 probe instruction', () => {
  const body = legalBrief({ vendor: 'anthropic' }).replace('R16 auth and headless probe status checked by the arbiter.', '');
  assert.ok(checkBriefText(body, { vendor: 'anthropic', requireStructural: true }).missing.includes('Claude R16 probe status'));
});

test('strict briefs reject a placeholder scope and missing leaf instruction', () => {
  const body = legalBrief().replace('src/example.js and its existing tests.', '<assigned files>').replace('leaf seat; no fan-out', 'worker');
  const result = checkBriefText(body, { requireStructural: true });
  assert.ok(result.missing.includes('real SCOPE block'));
  assert.ok(result.missing.includes('leaf seat'));
});

test('implement briefs must identify the implementation role', () => {
  assert.deepStrictEqual(checkBriefText(legalBrief(), { role: 'implement' }), { ok: true, missing: [] });
  assert.ok(checkBriefText(legalBrief({ role: 'review' }), { role: 'implement' }).missing.includes('implement'));
});

for (const role of ['review', 'verify', 'plan', 'research']) {
  test(`${role} briefs require read-only work`, () => {
    assert.deepStrictEqual(checkBriefText(legalBrief({ role }), { role }), { ok: true, missing: [] });
    assert.ok(checkBriefText(legalBrief(), { role }).missing.includes('read-only role'));
  });
}

test('an empty or non-text brief is missing every basic marker', () => {
  assert.deepStrictEqual(missingMarkers(''), ALL_MARKER_IDS);
  assert.deepStrictEqual(missingMarkers(null), ALL_MARKER_IDS);
});

test('valid marker text never proves that rules or skills exist', (t) => {
  const briefPath = makeBrief(t, legalBrief());
  assert.strictEqual(checkBriefText(legalBrief()).ok, true);
  const result = checkBriefFile(briefPath, { role: 'implement', vendor: 'openai', requireStructural: true });
  assert.strictEqual(result.ok, false);
  assert.ok(result.missing.some((item) => item.startsWith('staged rules:')));
  assert.ok(result.missing.some((item) => item.startsWith('staged seat:')));
});

test('structural checks accept all roles and vendor cards through the seat policy', (t) => {
  for (const vendor of ['openai', 'google', 'anthropic']) {
    for (const role of ['implement', 'review', 'verify', 'plan', 'research']) {
      const fixture = stagedBrief(t, { vendor, role });
      const result = checkBriefFile(fixture.briefPath, fixture.opts);
      assert.strictEqual(result.ok, true, `${vendor}/${role}: ${result.missing.join('; ')}`);
    }
  }
});

test('standalone structural checks read adjacent profile and hashed skills', (t) => {
  const fixture = stagedBrief(t);
  const result = checkBriefFile(fixture.briefPath, { role: 'implement', vendor: 'openai', requireStructural: true });
  assert.strictEqual(result.ok, true, result.missing.join('; '));
});

test('standalone structural checks apply the role from the generated profile', (t) => {
  const fixture = stagedBrief(t, { role: 'review' });
  fs.writeFileSync(fixture.briefPath, legalBrief(), 'utf8');
  const result = checkBriefFile(fixture.briefPath, { requireStructural: true });
  assert.strictEqual(result.ok, false);
  assert.ok(result.missing.includes('read-only role'));
});

test('generated contract skill and manifest pointers must match the staged root', (t) => {
  for (const target of ['skill', 'manifest']) {
    const fixture = stagedBrief(t);
    const file = target === 'skill'
      ? path.join(fixture.skillStage.root, fixture.seatProfile.skills[0], 'SKILL.md')
      : fixture.skillStage.manifestPath;
    const body = fs.readFileSync(fixture.opts.seatContractPath, 'utf8').replace(file, path.join(os.homedir(), '.claude', 'skills', 'SKILL.md'));
    fs.writeFileSync(fixture.opts.seatContractPath, body, 'utf8');
    const result = checkBriefFile(fixture.briefPath, fixture.opts);
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.some((item) => item.startsWith('staged seat:')));
  }
});

test('trusted STANDING v2 stages R01-R22 without replacing the BRIEF acknowledgment', (t) => {
  const fixture = stagedBrief(t, { v2: true });
  assert.strictEqual(fixture.opts.expectedRulesManifest.fingerprint, V2_FINGERPRINT);
  assert.strictEqual(fs.readFileSync(fixture.briefPath, 'utf8').split('\n')[0], 'BOUND-BRIEF-ACK');
  const result = checkBriefFile(fixture.briefPath, fixture.opts);
  assert.strictEqual(result.ok, true, result.missing.join('; '));
});

for (const target of ['RULES/R01-fixture.md', 'VENDOR.md']) {
  test(`structural check rejects a missing ${target} even when the brief names it`, (t) => {
    const fixture = stagedBrief(t);
    fs.unlinkSync(path.join(fixture.root, target));
    const result = checkBriefFile(fixture.briefPath, fixture.opts);
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.some((item) => item.includes(target)));
  });
}

test('caller-held rule hashes reject rewritten files and rewritten on-disk manifests', (t) => {
  const fixture = stagedBrief(t);
  const rule = path.join(fixture.root, 'RULES', 'R01-fixture.md');
  fs.appendFileSync(rule, 'changed\n', 'utf8');
  const manifestPath = path.join(fixture.root, 'rules-manifest.json');
  const rewritten = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  rewritten.files.find((entry) => entry.path === 'RULES/R01-fixture.md').sha256 =
    require('node:crypto').createHash('sha256').update(fs.readFileSync(rule)).digest('hex');
  fs.writeFileSync(manifestPath, JSON.stringify(rewritten), 'utf8');
  const result = checkBriefFile(fixture.briefPath, fixture.opts);
  assert.strictEqual(result.ok, false);
  assert.ok(result.missing.some((item) => /hash mismatch|rules manifest changed after staging/.test(item)));
});

test('missing or modified staged skill files fail even when skill names remain in the brief', (t) => {
  for (const mutation of ['missing', 'modified']) {
    const fixture = stagedBrief(t);
    const file = path.join(fixture.skillStage.root, fixture.seatProfile.skills[0], 'SKILL.md');
    if (mutation === 'missing') fs.unlinkSync(file);
    else fs.appendFileSync(file, 'changed\n', 'utf8');
    const result = checkBriefFile(fixture.briefPath, fixture.opts);
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.some((item) => item.startsWith('staged seat:')));
  }
});

test('caller-held skill hashes reject a rewritten on-disk manifest', (t) => {
  const fixture = stagedBrief(t);
  const skill = fixture.seatProfile.skills[0];
  const file = path.join(fixture.skillStage.root, skill, 'SKILL.md');
  fs.appendFileSync(file, 'changed\n', 'utf8');
  const manifest = JSON.parse(fs.readFileSync(fixture.skillStage.manifestPath, 'utf8'));
  const entry = manifest.skills[skill].find((item) => item.path === 'SKILL.md');
  entry.sha256 = require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  entry.bytes = fs.statSync(file).size;
  fs.writeFileSync(fixture.skillStage.manifestPath, JSON.stringify(manifest), 'utf8');
  assert.strictEqual(checkBriefFile(fixture.briefPath, fixture.opts).ok, false);
});

test('an arbiter skill added to the profile is rejected', (t) => {
  const fixture = stagedBrief(t);
  const seatProfile = { ...fixture.seatProfile, skills: [...fixture.seatProfile.skills, 'magi-mode'] };
  fs.writeFileSync(path.join(fixture.root, 'seat-profile.json'), JSON.stringify(seatProfile), 'utf8');
  const result = checkBriefFile(fixture.briefPath, { ...fixture.opts, seatProfile });
  assert.strictEqual(result.ok, false);
  assert.ok(result.missing.some((item) => item.includes('forbidden seat skills')));
});

test('a writable profile for a non-implementation role fails structural validation', (t) => {
  const fixture = stagedBrief(t, { role: 'review' });
  const seatProfile = { ...fixture.seatProfile, permissionProfile: 'workspace-write' };
  fs.writeFileSync(path.join(fixture.root, 'seat-profile.json'), JSON.stringify(seatProfile), 'utf8');
  const result = checkBriefFile(fixture.briefPath, { ...fixture.opts, seatProfile });
  assert.strictEqual(result.ok, false);
  assert.ok(result.missing.some((item) => item.includes('permission profile')));
});

test('profile vendor and role must match the requested seat', (t) => {
  const fixture = stagedBrief(t);
  for (const opts of [{ vendor: 'google' }, { role: 'review' }]) {
    const result = checkBriefFile(fixture.briefPath, { ...fixture.opts, ...opts });
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.some((item) => item.startsWith('staged seat:')));
  }
});

test('missing generated contract or changed generated profile fails closed', (t) => {
  const fixture = stagedBrief(t);
  fs.unlinkSync(fixture.opts.seatContractPath);
  assert.strictEqual(checkBriefFile(fixture.briefPath, fixture.opts).ok, false);
  fs.writeFileSync(fixture.opts.seatContractPath, '# restored\n', 'utf8');
  fs.writeFileSync(path.join(fixture.root, 'seat-profile.json'), JSON.stringify({ ...fixture.seatProfile, role: 'review' }), 'utf8');
  assert.strictEqual(checkBriefFile(fixture.briefPath, fixture.opts).ok, false);
});

test('file checks report missing markers and keep the resolved path', (t) => {
  const briefPath = makeBrief(t, 'no rules here');
  const result = checkBriefFile(briefPath);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.briefPath, path.resolve(briefPath));
  assert.deepStrictEqual(result.missing, ALL_MARKER_IDS);
  assert.match(formatMissing(result.missing), /SEAT-CONTRACT/);
});

test('main prints JSON for a valid basic brief and rejects a malformed brief', (t) => {
  const io = capture();
  assert.strictEqual(main(['--brief', makeBrief(t, legalBrief())], io), 0, io.stderrText);
  assert.strictEqual(JSON.parse(io.stdoutText).ok, true);
  const bad = capture();
  assert.strictEqual(main(['--brief', makeBrief(t, 'magi-mode only')], bad), 1);
  assert.match(bad.stderrText, /^RULES_FAIL:/);
  for (const marker of ALL_MARKER_IDS) assert.ok(bad.stderrText.includes(marker));
});

test('missing inputs and unsupported role/vendor are argument errors', () => {
  for (const args of [[], ['--brief', path.join(os.tmpdir(), 'magi-no-such-brief.md')], ['--role', 'arbiter'], ['--vendor', 'xai']]) {
    const io = capture();
    assert.strictEqual(main(args, io), 2, io.stderrText);
    assert.match(io.stderrText, /^ARGUMENT_ERROR:/);
  }
});

test('the CLI entry prints one basic-check JSON report', (t) => {
  const briefPath = makeBrief(t, legalBrief());
  const result = spawnSync(process.execPath, [path.join(__dirname, 'cli-brief-rules-check.js'), '--brief', briefPath], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(JSON.parse(result.stdout).ok, true);
});

test('shipped templates pass text validation but cannot replace staged artifacts', () => {
  for (const templatePath of TEMPLATE_PATHS) {
    assert.strictEqual(checkBriefFile(templatePath).ok, true, templatePath);
    assert.strictEqual(checkBriefFile(templatePath, { requireStructural: true }).ok, false, templatePath);
  }
});
