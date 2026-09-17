// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { bindWorktree } = require('./host-helper-worktree.js');

test('worktree bind accepts a CONCLAVE-allowed directory and never counts as a vote', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-worktree-bind-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'tree');
  fs.mkdirSync(cwd);
  const out = path.join(root, 'binding.json');
  const binding = bindWorktree({ cwd, out, env: { CONCLAVE_DEV_ROOT: root } });
  assert.equal(binding.tally, 'never');
  assert.equal(binding.position, false);
  assert.equal(binding.kind, 'host-helper-worktree');
  assert.equal(fs.realpathSync.native(JSON.parse(fs.readFileSync(out, 'utf8')).cwd), fs.realpathSync.native(cwd));
});

test('worktree bind rejects a directory outside CONCLAVE allowed roots', () => {
  const inside = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-worktree-in-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-worktree-out-'));
  test.after(() => {
    fs.rmSync(inside, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  assert.throws(() => bindWorktree({ cwd: outside, env: { CONCLAVE_DEV_ROOT: inside } }), /outside CONCLAVE allowed roots/);
});
