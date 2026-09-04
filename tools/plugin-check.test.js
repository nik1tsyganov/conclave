'use strict';

const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { existsSync, readFileSync } = require('node:fs');
const { containsForbidden } = require('./plugin-check.js');
const {
  SOURCE_SURFACE,
  checkManifestSurface,
} = require('./plugin-surface.js');

const node = process.execPath;
const ROOT = path.resolve(__dirname, '..');

describe('plugin-check', () => {
  it('plugin-check passes', () => {
    const r = spawnSync(node, [path.join(__dirname, 'plugin-check.js')], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  });

  it('containsForbidden matches case-insensitively', () => {
    const text = 'This is a test with NoT lOgGeD iN inside.';
    const needles = ['Not logged in', 'AUTH REQUIRED'];
    assert.strictEqual(containsForbidden(text, needles), 'Not logged in');
  });

  it('source plugin.json declares surface paths that exist in the repo', () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, '.cursor-plugin/plugin.json'), 'utf8'));
    const surface = checkManifestSurface(manifest, SOURCE_SURFACE);
    assert.strictEqual(surface.ok, true, surface.error);
    for (const rel of Object.values(SOURCE_SURFACE)) {
      assert.ok(existsSync(path.resolve(ROOT, rel)), `missing ${rel}`);
    }
  });

  it('fails the surface check when a Conclave path field is omitted', () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, '.cursor-plugin/plugin.json'), 'utf8'));
    for (const field of ['skills', 'rules', 'agents', 'commands']) {
      const stripped = { ...manifest };
      delete stripped[field];
      const surface = checkManifestSurface(stripped, SOURCE_SURFACE);
      assert.strictEqual(surface.ok, false, `${field} should be required`);
      assert.match(surface.error, new RegExp(field));
    }
  });
});
