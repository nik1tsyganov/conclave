'use strict';

const { spawnSync } = require('node:child_process');
const it = require('node:test').it;
const assert = require('node:assert');
const path = require('node:path');

const node = process.execPath;

it('plugin-check passes', () => {
  const r = spawnSync(node, [path.join(__dirname, 'plugin-check.js')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
});
