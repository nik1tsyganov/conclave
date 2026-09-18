// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { briefFixture, ruleFixture, temporary } = require('./test-fixtures.js');
const { FINGERPRINT, FINGERPRINT_V2, stageRules, verifyStagedRules } = require('./cli-rules-stage.js');
const { resolveRulesRoot } = require('./runtime-paths.js');
const { hashFile } = require('./dispatch-evidence.js');

test('v2 source rule set rejects R23 before writing staged instructions', t => {
  const root = temporary(t);
  const rulesRoot = ruleFixture(root);
  const briefPath = briefFixture(path.join(root, 'brief'));
  fs.writeFileSync(path.join(rulesRoot, 'RULES', 'R23-extra.md'), 'extra\n', 'utf8');
  assert.throws(() => stageRules({ rulesRoot, briefPath }), /exactly R01-R22/);
  assert.deepEqual(fs.readdirSync(path.dirname(briefPath)), ['BRIEF.md']);
});

test('a saved v2 manifest cannot add a hashed R23 rule', t => {
  const root = temporary(t);
  const rulesRoot = ruleFixture(root);
  const briefPath = briefFixture(path.join(root, 'brief'));
  const staged = stageRules({ rulesRoot, briefPath });
  const file = path.join(staged.stagedRules, 'R23-extra.md');
  fs.writeFileSync(file, 'extra\n', 'utf8');
  staged.manifest.files.push({ path: 'RULES/R23-extra.md', sha256: hashFile(file) });
  fs.writeFileSync(staged.manifestPath, JSON.stringify(staged.manifest), 'utf8');
  assert.throws(() => verifyStagedRules(briefPath, staged.manifest), /exactly R01-R22/);
});

test('historical v1 keeps distinct hashed extra rules', t => {
  const root = temporary(t);
  const rulesRoot = ruleFixture(root);
  const briefPath = briefFixture(path.join(root, 'brief'));
  fs.writeFileSync(path.join(rulesRoot, 'STANDING.md'), FINGERPRINT + '\n', 'utf8');
  fs.writeFileSync(path.join(rulesRoot, 'RULES', 'R23-extra.md'), 'extra\n', 'utf8');
  const staged = stageRules({ rulesRoot, briefPath });
  assert.deepEqual(verifyStagedRules(briefPath, staged.manifest), staged.manifest);
});

// The pack ships with the runtime (2026-09-18). These four hold the line between a
// DEFAULT, which is what makes a clone runnable, and a FALLBACK, which would let a
// run quietly use a policy nobody chose.

test('the shipped pack stages with no environment at all, and the manifest names it', t => {
  const root = temporary(t);
  const briefPath = briefFixture(path.join(root, 'brief'));
  const staged = stageRules({ briefPath });
  assert.equal(staged.rulesRoot, fs.realpathSync(path.join(__dirname, '..', 'standing-rules')));
  assert.equal(staged.manifest.sourceRoot, staged.rulesRoot);
  assert.equal(staged.manifest.fingerprint, FINGERPRINT_V2);
  assert.deepEqual(verifyStagedRules(briefPath, staged.manifest), staged.manifest);
});

test('a rules root that is named but unreadable stops the run instead of falling back to the shipped pack', t => {
  const root = temporary(t);
  const briefPath = briefFixture(path.join(root, 'brief'));
  assert.throws(
    () => stageRules({ briefPath, rulesRoot: path.join(root, 'no-such-pack') }),
    (error) => error.code === 'RULES_SOURCE_MISSING' && /no-such-pack/.test(error.message),
  );
  assert.deepEqual(fs.readdirSync(path.dirname(briefPath)), ['BRIEF.md']);
});

test('CONCLAVE_RULES_ROOT set but empty is an error, not an unset variable', () => {
  assert.throws(
    () => resolveRulesRoot({ env: { CONCLAVE_RULES_ROOT: '  ' }, defaultRulesRoot: '/opt/shipped' }),
    /set but empty/,
  );
});

test('an external pack still wins over the shipped one', t => {
  const root = temporary(t);
  const rulesRoot = ruleFixture(root);
  const briefPath = briefFixture(path.join(root, 'brief'));
  const staged = stageRules({ rulesRoot, briefPath });
  assert.equal(staged.rulesRoot, fs.realpathSync(rulesRoot));
  assert.notEqual(staged.rulesRoot, fs.realpathSync(path.join(__dirname, '..', 'standing-rules')));
});

test('the shipped pack passes its own completeness check', () => {
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, ['check-rules.cjs'], { cwd: path.join(__dirname, '..', 'standing-rules'), encoding: 'utf8' });
  assert.match(out, /R01-R22: complete, unique, indexed/);
});
