// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { briefFixture, ruleFixture, temporary } = require('./test-fixtures.js');
const { FINGERPRINT, stageRules, verifyStagedRules } = require('./cli-rules-stage.js');
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
