'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const {
  magiCursorManifest,
  magiCliManifest,
  writeManifest,
  readInstalledManifest,
} = require('./install-plugin.js');
const {
  INSTALLED_MAGI_SURFACE,
  INSTALLED_MAGI_CLI_SURFACE,
  checkManifestSurface,
} = require('./plugin-surface.js');

describe('install-plugin manifests', () => {
  it('writes Conclave-style surface paths for the installed magi plugin', () => {
    const manifest = magiCursorManifest();
    const surface = checkManifestSurface(manifest, INSTALLED_MAGI_SURFACE);
    assert.strictEqual(surface.ok, true, surface.error);
    assert.strictEqual(manifest.skills, './skills/');
    assert.strictEqual(manifest.rules, './rules/');
    assert.strictEqual(manifest.agents, './agents/');
    assert.strictEqual(manifest.commands, './commands/');
  });

  it('writes skills/rules/commands and omits agents for magi-cursor-cli', () => {
    const manifest = magiCliManifest();
    const surface = checkManifestSurface(manifest, INSTALLED_MAGI_CLI_SURFACE);
    assert.strictEqual(surface.ok, true, surface.error);
    assert.strictEqual(Object.hasOwn(manifest, 'agents'), false);
  });

  it('fails the surface check when an installer-written field is missing', () => {
    const stripped = { ...magiCursorManifest() };
    delete stripped.skills;
    const surface = checkManifestSurface(stripped, INSTALLED_MAGI_SURFACE);
    assert.strictEqual(surface.ok, false);
    assert.match(surface.error, /skills/);

    const withAgents = { ...magiCliManifest(), agents: './agents/' };
    const cli = checkManifestSurface(withAgents, INSTALLED_MAGI_CLI_SURFACE);
    assert.strictEqual(cli.ok, false);
    assert.match(cli.error, /agents/);
  });

  it('persists surface fields into the dest plugin.json', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'install-plugin-'));
    try {
      writeManifest(dir, magiCursorManifest());
      const written = readInstalledManifest(dir);
      assert.strictEqual(written.ok, true, written.error);
      assert.deepStrictEqual(written.manifest, magiCursorManifest());
      assert.strictEqual(
        readFileSync(path.join(dir, '.cursor-plugin', 'plugin.json'), 'utf8'),
        `${JSON.stringify(magiCursorManifest(), null, 2)}\n`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
