'use strict';

const { spawnSync } = require('node:child_process');
const it = require('node:test').it;
const assert = require('node:assert');
const path = require('node:path');
const { containsForbidden } = require('./plugin-check.js');

const node = process.execPath;

it('plugin-check passes', () => {
  const r = spawnSync(node, [path.join(__dirname, 'plugin-check.js')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
});

it('containsForbidden matches case-insensitively', () => {
  const text = 'This is a test with NoT lOgGeD iN inside.';
  const needles = ['Not logged in', 'AUTH REQUIRED'];
  assert.strictEqual(containsForbidden(text, needles), 'Not logged in');
});
