#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  INSTALLED_MAGI_SURFACE,
  INSTALLED_MAGI_CLI_SURFACE,
  applySurfaceFields,
  checkManifestSurface,
} = require('./plugin-surface.js');

const ROOT = path.resolve(__dirname, '..');
const PLUGINS_DIR = path.join(os.homedir(), '.cursor', 'plugins', 'local');
const MAGI_DEST = path.join(PLUGINS_DIR, 'magi');
const MAGI_CLI_DEST = path.join(PLUGINS_DIR, 'magi-cursor-cli');
const USER_SKILL_MAGI = path.join(os.homedir(), '.cursor', 'skills', 'magi');
const USER_SKILL_MAGI_CLI = path.join(os.homedir(), '.cursor', 'skills', 'magi-cli');
const USER_RULES_DIR = path.join(os.homedir(), '.cursor', 'rules');
const CLAUDE_CMD_DIR = path.join(os.homedir(), '.claude', 'commands');

const CLI_RUNTIME_TOOLS = Object.freeze([
  'activation-check.js', 'hog-check.js', 'host-resolver.js', 'position-tally.js',
  'cli-adapters.js', 'cli-brief-rules-check.js', 'cli-idle.js', 'cli-pointer.js',
  'cli-process.js', 'cli-proof.js', 'cli-rules-stage.js', 'cli-runner.js',
  'dispatch-matrix.js', 'dispatch-run.js', 'dispatch-schema.js', 'magi-cli-preflight.js',
  'model-availability.js', 'seat-policy.js', 'telemetry-append.js', 'vendor-binaries.js',
  'dispatch-log.pass.jsonl', 'dispatch-log.fail.jsonl',
]);

function bail(msg) { console.error(`CANNOT RUN: ${msg}`); process.exit(2); }
function copyDir(src, dest) { if (!fs.existsSync(src)) bail(`missing ${src}`); fs.cpSync(src, dest, { recursive: true }); }
function copyFile(src, dest) { if (!fs.existsSync(src)) bail(`missing ${src}`); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); }
function ensureClean(dest) { if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(dest, { recursive: true }); }
function writeManifest(dest, manifest) { fs.mkdirSync(path.join(dest, '.cursor-plugin'), { recursive: true }); fs.writeFileSync(path.join(dest, '.cursor-plugin', 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`); }

function magiCursorManifest() {
  return applySurfaceFields({
    name: 'magi', displayName: 'MAGI Cursor',
    description: 'Original MAGI tri-seat (Claude + Codex + Gemini). Cursor Grok arbiter routes; it does not implement. Not CONCLAVE.',
    version: '0.1.0', author: { name: 'Nikita Tsyganov' }, repository: 'https://github.com/nik1tsyganov/magi.git',
    license: 'MIT', keywords: ['magi', 'multi-vendor', 'cursor', 'dispatch'],
  }, INSTALLED_MAGI_SURFACE);
}

function magiCliManifest() {
  return applySurfaceFields({
    name: 'magi-cursor-cli', displayName: 'MAGI Cursor CLI',
    description: 'Grok arbiter + vendor CLIs with fail-closed matrix/seat/rules/proof/telemetry enforcement. Not CONCLAVE.',
    version: '0.1.0', author: { name: 'Nikita Tsyganov' }, repository: 'https://github.com/nik1tsyganov/magi.git',
    license: 'MIT', keywords: ['magi', 'magi-cli', 'multi-vendor', 'cursor', 'cli'],
  }, INSTALLED_MAGI_CLI_SURFACE);
}

function readInstalledManifest(dest) {
  const full = path.join(dest, '.cursor-plugin', 'plugin.json');
  if (!fs.existsSync(full)) return { ok: false, error: 'missing .cursor-plugin/plugin.json' };
  try { return { ok: true, manifest: JSON.parse(fs.readFileSync(full, 'utf8')), error: null }; }
  catch (error) { return { ok: false, error: `invalid .cursor-plugin/plugin.json: ${error.message}` }; }
}

function installMagiCursor() {
  ensureClean(MAGI_DEST);
  writeManifest(MAGI_DEST, magiCursorManifest());
  copyDir(path.join(ROOT, '.cursor', 'skills'), path.join(MAGI_DEST, 'skills'));
  copyDir(path.join(ROOT, '.cursor', 'rules'), path.join(MAGI_DEST, 'rules'));
  copyDir(path.join(ROOT, 'agents'), path.join(MAGI_DEST, 'agents'));
  copyDir(path.join(ROOT, 'tools'), path.join(MAGI_DEST, 'tools'));
  fs.mkdirSync(path.join(MAGI_DEST, 'commands'), { recursive: true });
  copyFile(path.join(ROOT, 'commands', 'magi.md'), path.join(MAGI_DEST, 'commands', 'magi.md'));
  copyFile(path.join(ROOT, 'commands', 'magi-cli.md'), path.join(MAGI_DEST, 'commands', 'magi-cli.md'));
}

function installMagiCursorCli() {
  ensureClean(MAGI_CLI_DEST);
  writeManifest(MAGI_CLI_DEST, magiCliManifest());
  copyDir(path.join(ROOT, '.cursor', 'skills', 'magi-cli'), path.join(MAGI_CLI_DEST, 'skills', 'magi-cli'));
  copyDir(path.join(ROOT, '.cursor', 'rules'), path.join(MAGI_CLI_DEST, 'rules'));
  copyFile(path.join(ROOT, 'commands', 'magi-cli.md'), path.join(MAGI_CLI_DEST, 'commands', 'magi-cli.md'));
  for (const tool of CLI_RUNTIME_TOOLS) copyFile(path.join(ROOT, 'tools', tool), path.join(MAGI_CLI_DEST, 'tools', tool));
  if (fs.existsSync(path.join(ROOT, 'tools', 'templates'))) copyDir(path.join(ROOT, 'tools', 'templates'), path.join(MAGI_CLI_DEST, 'tools', 'templates'));
}

function installUserGlobals() {
  fs.mkdirSync(USER_RULES_DIR, { recursive: true });
  for (const rule of ['magi-arbiter.mdc', 'magi-activation.mdc', 'magi-orchestrator.mdc', 'live-check.mdc']) copyFile(path.join(ROOT, '.cursor', 'rules', rule), path.join(USER_RULES_DIR, rule));
  copyFile(path.join(ROOT, 'claude-commands', 'magi.md'), path.join(CLAUDE_CMD_DIR, 'magi.md'));
  if (fs.existsSync(USER_SKILL_MAGI)) fs.rmSync(USER_SKILL_MAGI, { recursive: true, force: true });
  copyDir(path.join(ROOT, '.cursor', 'skills', 'magi'), USER_SKILL_MAGI);
  if (fs.existsSync(USER_SKILL_MAGI_CLI)) fs.rmSync(USER_SKILL_MAGI_CLI, { recursive: true, force: true });
  copyDir(path.join(ROOT, '.cursor', 'skills', 'magi-cli'), USER_SKILL_MAGI_CLI);
}

function checkSurface(dest, expected, label) {
  const written = readInstalledManifest(dest);
  if (!written.ok) throw new Error(`${label} ${written.error}`);
  const surface = checkManifestSurface(written.manifest, expected);
  if (!surface.ok) throw new Error(`${label} ${surface.error}`);
}
function checkMagi() {
  const required = ['skills/magi/SKILL.md', 'rules/magi-arbiter.mdc', 'commands/magi.md', 'agents/implementer.md'];
  const missing = required.filter((rel) => !fs.existsSync(path.join(MAGI_DEST, rel)));
  if (missing.length) throw new Error(`magi missing: ${missing.join(', ')}`);
  checkSurface(MAGI_DEST, INSTALLED_MAGI_SURFACE, 'magi');
}
function checkMagiCli() {
  const required = [
    'skills/magi-cli/SKILL.md',
    'skills/magi-cli/references/cursor-cli.md',
    'skills/magi-cli/references/dispatch-matrix.json',
    'skills/magi-cli/references/seat-profiles.json',
    'rules/magi-arbiter.mdc',
    'commands/magi-cli.md',
    ...CLI_RUNTIME_TOOLS.filter((name) => name.endsWith('.js')).map((name) => `tools/${name}`),
  ];
  const missing = required.filter((rel) => !fs.existsSync(path.join(MAGI_CLI_DEST, rel)));
  if (missing.length) throw new Error(`magi-cursor-cli missing: ${missing.join(', ')}`);
  if (fs.existsSync(path.join(MAGI_CLI_DEST, 'agents'))) throw new Error('magi-cursor-cli must not have an agents/ directory');
  checkSurface(MAGI_CLI_DEST, INSTALLED_MAGI_CLI_SURFACE, 'magi-cursor-cli');
}

function main() {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  installMagiCursor();
  installMagiCursorCli();
  installUserGlobals();
  checkMagi();
  checkMagiCli();
  console.log(`MAGI Cursor installed at ${MAGI_DEST}`);
  console.log(`MAGI Cursor CLI installed at ${MAGI_CLI_DEST}`);
  console.log('MAGI CLI runtime is installed-relative; C:\\src\\magi is no longer required merely to launch seats.');
  console.log('The standing-rules pack still requires ai-ops-vault (default C:\\src\\ai-ops-vault or MAGI_RULES_ROOT).');
  console.log('Reload Cursor and enable both plugins.');
}

if (require.main === module) {
  try { main(); process.exit(0); }
  catch (error) { bail(error instanceof Error ? error.message : String(error)); }
}
module.exports = { CLI_RUNTIME_TOOLS, magiCursorManifest, magiCliManifest, writeManifest, readInstalledManifest, checkMagi, checkMagiCli };
