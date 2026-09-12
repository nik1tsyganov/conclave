'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { bindWorktree } = require('./host-helper-worktree.js');
const { temporary } = require('./test-fixtures.js');

test('worktree bind rejects a junction before writing a binding', t => {
  const root = temporary(t, 'magi-worktree-junction-');
  const allowed = path.join(root, 'allowed');
  const target = path.join(root, 'outside');
  fs.mkdirSync(allowed); fs.mkdirSync(target);
  const link = path.join(allowed, 'alias');
  const out = path.join(root, 'binding.json');
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => bindWorktree({ cwd: link, out, env: { MAGI_DEV_ROOT: allowed, MAGI_ALLOWED_WORKSPACE_ROOTS: '' } }), /symlink|junction/);
  assert.equal(fs.existsSync(out), false);
  assert.deepEqual(fs.readdirSync(target), []);
});

test('worktree bind accepts a MAGI-allowed directory and never counts as a vote', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-worktree-bind-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'tree');
  fs.mkdirSync(cwd);
  const out = path.join(root, 'binding.json');
  const binding = bindWorktree({ cwd, out, env: { MAGI_DEV_ROOT: root } });
  assert.equal(binding.tally, 'never');
  assert.equal(binding.position, false);
  assert.equal(binding.kind, 'host-helper-worktree');
  assert.equal(fs.realpathSync.native(JSON.parse(fs.readFileSync(out, 'utf8')).cwd), fs.realpathSync.native(cwd));
});

test('worktree bind rejects a directory outside MAGI allowed roots', () => {
  const inside = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-worktree-in-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-worktree-out-'));
  test.after(() => {
    fs.rmSync(inside, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  assert.throws(() => bindWorktree({ cwd: outside, env: { MAGI_DEV_ROOT: inside } }), /outside MAGI allowed roots/);
});
