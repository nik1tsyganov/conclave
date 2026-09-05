'use strict';

const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { existsSync, readFileSync } = require('node:fs');
const { containsForbidden, checkBriefTemplate } = require('./plugin-check.js');
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

  it('validates the lean template without orchestration or bridge skills', () => {
    const body = readFileSync(path.join(ROOT, 'tools/templates/brief-rules-block.md'), 'utf8');
    const result = checkBriefTemplate(body);
    assert.strictEqual(result.ok, true, result.missing.join(', '));
  });

  it('rejects templates missing leaf, staged skill, or vendor transport instructions', () => {
    const body = readFileSync(path.join(ROOT, 'tools/templates/brief-rules-block.md'), 'utf8');
    for (const stripped of [
      body.replaceAll('SEAT-CONTRACT.md', 'contract-document'),
      body.replaceAll('skills-manifest.json', 'manifest-file').replaceAll('staged skills', 'tools'),
      body.replaceAll('leaf seat', 'worker').replaceAll('no fan-out', 'one task'),
      body.replaceAll('casper_via=agy', 'Vendor: agy'),
    ]) {
      assert.strictEqual(checkBriefTemplate(stripped).ok, false);
    }
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
