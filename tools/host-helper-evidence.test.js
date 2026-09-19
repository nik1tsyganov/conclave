// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const { stageHelperEvidence } = require('./host-helper-evidence.js');
const { workspaceDiffText } = require('./dispatch-evidence.js');

test('host helper evidence is staged as a non-voting read directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-host-helper-'));
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

test('workspaceDiffText reports a missing git baseline instead of an empty diff', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-diff-no-git-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const text = workspaceDiffText(root);
  assert.ok(text.startsWith('# NO GIT BASELINE\n'));
  assert.ok(text.includes(root));
  assert.ok(text.includes('unverifiable'));
});

function gitRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-diff-git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (args) => execFileSync('git', ['-C', root, '-c', 'user.email=test@example.com', '-c', 'user.name=Test', ...args]);
  git(['init']);
  fs.writeFileSync(path.join(root, 'unit-file.txt'), 'before\n', 'utf8');
  git(['add', 'unit-file.txt']);
  git(['commit', '-m', 'baseline']);
  return root;
}

test('workspaceDiffText in a dirty git repo returns the command line and the changed file', () => {
  const root = gitRepo(test);
  fs.writeFileSync(path.join(root, 'unit-file.txt'), 'after\n', 'utf8');
  const text = workspaceDiffText(root);
  assert.ok(text.startsWith('$ git diff --stat && git diff && git status --porcelain\n'));
  assert.ok(text.includes('unit-file.txt'));
});

test('workspaceDiffText in a clean git repo is distinguishable from a missing baseline', () => {
  const root = gitRepo(test);
  const text = workspaceDiffText(root);
  assert.ok(text.startsWith('$ git diff --stat && git diff && git status --porcelain\n'));
  assert.ok(!text.startsWith('# NO GIT BASELINE'));
  assert.ok(!text.includes('unit-file.txt'));
});
