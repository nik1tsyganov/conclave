// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = __dirname;
const fingerprint = 'CONCLAVE-CLI-STANDING v2 — Read this file and RULES/INDEX.md in full before task work.';
assert.equal(fs.readFileSync(path.join(root, 'STANDING.md'), 'utf8').split(/\r?\n/)[0], fingerprint);
for (const name of ['VENDOR.md','RULES/INDEX.md','BRIEF-RULES-BLOCK.md']) assert.ok(fs.statSync(path.join(root,name)).isFile(), name);
const files = fs.readdirSync(path.join(root, 'RULES')).filter(f => /^R\d{2}-.*\.md$/.test(f));
assert.equal(files.length, 22);
const index = fs.readFileSync(path.join(root, 'RULES/INDEX.md'), 'utf8');
for (let i = 1; i <= 22; i++) {
  const prefix = `R${String(i).padStart(2,'0')}-`;
  const matches = files.filter(f => f.startsWith(prefix));
  assert.equal(matches.length, 1, prefix);
  assert.ok(index.includes(matches[0]), `index link for ${prefix}`);
}
console.log('STANDING v2 / R01-R22: complete, unique, indexed');
