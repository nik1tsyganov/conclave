// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { stageHelperEvidence } = require('./host-helper-evidence.js');

test('host helper evidence is staged as a non-voting read directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-host-helper-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const from = path.join(root, 'browser');
  fs.mkdirSync(from);
  fs.writeFileSync(path.join(from, 'screenshot-note.txt'), 'clicked submit\n', 'utf8');
  const manifest = stageHelperEvidence({ runDir: root, label: 'browser-verify-1', from });
  assert.equal(manifest.tally, 'never');
  assert.equal(manifest.position, false);
  assert.ok(fs.existsSync(path.join(manifest.destination, 'screenshot-note.txt')));
  assert.equal(manifest.files.length, 1);
  assert.throws(() => stageHelperEvidence({ runDir: root, label: 'browser-verify-1', from }), /already exists/);
});
