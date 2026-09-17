#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CLI_RUNTIME_TOOLS, canonicalPlainPath, pathsOverlap, resolveRuntimePaths } = require('./runtime-paths.js');
const { regularFiles } = require('./cli-skill-stage.js');
const {
  INSTALLED_CONCLAVE_SURFACE,
  INSTALLED_CONCLAVE_CLI_SURFACE,
  applySurfaceFields,
  checkManifestSurface,
} = require('./plugin-surface.js');

const ROOT = path.resolve(__dirname, '..');
const PLUGINS_DIR = path.join(os.homedir(), '.cursor', 'plugins', 'local');
const CONCLAVE_DEST = path.join(PLUGINS_DIR, 'conclave');
const CONCLAVE_CLI_DEST = path.join(PLUGINS_DIR, 'conclave-cursor-cli');
const USER_SKILL_CONCLAVE = path.join(os.homedir(), '.cursor', 'skills', 'conclave');
const USER_SKILL_CONCLAVE_CLI = path.join(os.homedir(), '.cursor', 'skills', 'conclave-cli');
const USER_RULES_DIR = path.join(os.homedir(), '.cursor', 'rules');
const CLAUDE_CMD_DIR = path.join(os.homedir(), '.claude', 'commands');

function bail(msg) { console.error(`CANNOT RUN: ${msg}`); process.exit(2); }
function copyDir(src, dest) { if (!fs.existsSync(src)) throw new Error(`missing ${src}`); fs.cpSync(src, dest, { recursive: true }); }
function copyFile(src, dest) { if (!fs.existsSync(src)) throw new Error(`missing ${src}`); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); }
function writeManifest(dest, manifest) { fs.mkdirSync(path.join(dest, '.cursor-plugin'), { recursive: true }); fs.writeFileSync(path.join(dest, '.cursor-plugin', 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'); }

function prepareInstall(sourceRoot, destination, manifest, sources, validateFiles = () => {}) {
  const source = canonicalPlainPath(sourceRoot);
  const target = canonicalPlainPath(destination);
  if (pathsOverlap(source, target)) throw new Error('installer source and destination overlap; refusing to replace either tree');
  const files = new Map();
  const directories = new Set();
  function directory(relative) {
    const segments = relative.split('/');
    for (let i = 1; i <= segments.length; i += 1) directories.add(segments.slice(0, i).join('/'));
  }
  for (const [from, to] of sources) {
    const sourcePath = canonicalPlainPath(path.join(source, from));
    const stat = fs.lstatSync(sourcePath);
    if (stat.isDirectory()) {
      directory(to);
      const subdirectories = [];
      for (const file of regularFiles(sourcePath, sourcePath, [], subdirectories)) {
        files.set(`${to}/${path.relative(sourcePath, file).replaceAll('\\', '/')}`, fs.readFileSync(file));
      }
      for (const dir of subdirectories) directory(`${to}/${path.relative(sourcePath, dir).replaceAll('\\', '/')}`);
    } else if (stat.isFile()) {
      directory(path.posix.dirname(to));
      files.set(to, fs.readFileSync(sourcePath));
    } else throw new Error(`unsupported installer source: ${sourcePath}`);
  }
  directory('.cursor-plugin');
  files.set('.cursor-plugin/plugin.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
  validateFiles(files);
  if (fs.existsSync(target)) {
    if (!fs.lstatSync(target).isDirectory()) throw new Error(`installer destination is not a directory: ${target}`);
    const existingDirectories = [];
    const existingFiles = regularFiles(target, target, [], existingDirectories);
    if (existingFiles.length || existingDirectories.length) {
      const installed = readInstalledManifest(target);
      const surface = manifest.name === 'conclave-cursor-cli' ? INSTALLED_CONCLAVE_CLI_SURFACE : INSTALLED_CONCLAVE_SURFACE;
      if (!installed.ok || installed.manifest.name !== manifest.name || installed.manifest.repository !== manifest.repository ||
          !checkManifestSurface(installed.manifest, surface).ok) {
        throw new Error(`refusing to replace unrelated directory: ${target}`);
      }
      for (const file of existingFiles) {
        const relative = path.relative(target, file).replaceAll('\\', '/');
        if (!files.has(relative)) throw new Error(`refusing to remove unrelated destination file: ${relative}`);
      }
      for (const dir of existingDirectories) {
        const relative = path.relative(target, dir).replaceAll('\\', '/');
        if (!directories.has(relative)) throw new Error(`refusing to remove unrelated destination directory: ${relative}`);
      }
    }
  }
  return { target, files, directories };
}

function writeInstall(prepared) {
  // Every source byte and destination entry was checked before the first write.
  fs.rmSync(prepared.target, { recursive: true, force: true });
  fs.mkdirSync(prepared.target, { recursive: true });
  for (const dir of prepared.directories) fs.mkdirSync(path.join(prepared.target, ...dir.split('/')), { recursive: true });
  for (const [relative, body] of prepared.files) fs.writeFileSync(path.join(prepared.target, ...relative.split('/')), body);
  return prepared.target;
}

function conclaveCursorManifest() {
  return applySurfaceFields({
    name: 'conclave', displayName: 'CONCLAVE Cursor',
    description: 'Original CONCLAVE tri-seat (Claude + Codex + Gemini). Cursor Grok arbiter routes; it does not implement. Not CONCLAVE.',
    version: '0.1.0', author: { name: 'Nikita Tsyganov' }, repository: 'https://github.com/nik1tsyganov/conclave.git',
    license: 'MIT', keywords: ['conclave', 'multi-vendor', 'cursor', 'dispatch'],
  }, INSTALLED_CONCLAVE_SURFACE);
}

function conclaveCliManifest() {
  return applySurfaceFields({
    name: 'conclave-cursor-cli', displayName: 'CONCLAVE Cursor CLI',
    description: 'Grok arbiter + vendor CLIs with fail-closed matrix/seat/rules/proof/telemetry enforcement. Not CONCLAVE.',
    version: '0.1.0', author: { name: 'Nikita Tsyganov' }, repository: 'https://github.com/nik1tsyganov/conclave.git',
    license: 'MIT', keywords: ['conclave', 'conclave-cli', 'multi-vendor', 'cursor', 'cli'],
  }, INSTALLED_CONCLAVE_CLI_SURFACE);
}

function readInstalledManifest(dest) {
  const full = path.join(dest, '.cursor-plugin', 'plugin.json');
  if (!fs.existsSync(full)) return { ok: false, error: 'missing .cursor-plugin/plugin.json' };
  try { return { ok: true, manifest: JSON.parse(fs.readFileSync(full, 'utf8')), error: null }; }
  catch (error) { return { ok: false, error: `invalid .cursor-plugin/plugin.json: ${error.message}` }; }
}

function installConclaveCursor() {
  return writeInstall(prepareInstall(ROOT, CONCLAVE_DEST, conclaveCursorManifest(), [
    ['.cursor/skills', 'skills'], ['.cursor/rules', 'rules'], ['agents', 'agents'],
    ['tools', 'tools'], ['seat-skills', 'seat-skills'],
    ['commands/conclave.md', 'commands/conclave.md'], ['commands/conclave-cli.md', 'commands/conclave-cli.md'],
  ]));
}

function validateCliFiles(files) {
  for (const required of ['skills/conclave-cli/SKILL.md', 'skills/conclave-cli/references/cursor-cli.md',
    'skills/conclave-cli/references/dispatch-matrix.json', 'skills/conclave-cli/references/seat-profiles.json',
    'rules/conclave-arbiter.mdc']) {
    if (!files.has(required)) throw new Error(`installer source missing required file: ${required}`);
  }
  const profiles = JSON.parse(files.get('skills/conclave-cli/references/seat-profiles.json').toString('utf8'));
  const skills = new Set(['baseSkills', 'roleSkills', 'classSkills'].flatMap(key => Object.values(profiles[key] || {}).flat()));
  for (const skill of skills) {
    if (typeof skill !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(skill) || !files.has(`seat-skills/${skill}/SKILL.md`)) {
      throw new Error(`installer source missing bundled seat skill: ${skill}`);
    }
  }
}

function installConclaveCursorCli({ destination = CONCLAVE_CLI_DEST, sourceRoot = ROOT } = {}) {
  const prepared = prepareInstall(sourceRoot, destination, conclaveCliManifest(), [
    ['.cursor/skills/conclave-cli', 'skills/conclave-cli'], ['.cursor/rules', 'rules'],
    ['commands/conclave-cli.md', 'commands/conclave-cli.md'], ['tools/templates', 'tools/templates'],
    ['seat-skills', 'seat-skills'], ['skill-sources.json', 'skill-sources.json'],
    ...CLI_RUNTIME_TOOLS.map(tool => [`tools/${tool}`, `tools/${tool}`]),
  ], validateCliFiles);
  return writeInstall(prepared);
}

function installUserGlobals() {
  fs.mkdirSync(USER_RULES_DIR, { recursive: true });
  for (const rule of ['conclave-arbiter.mdc', 'conclave-activation.mdc', 'conclave-orchestrator.mdc', 'live-check.mdc']) copyFile(path.join(ROOT, '.cursor', 'rules', rule), path.join(USER_RULES_DIR, rule));
  copyFile(path.join(ROOT, 'claude-commands', 'conclave.md'), path.join(CLAUDE_CMD_DIR, 'conclave.md'));
  if (fs.existsSync(USER_SKILL_CONCLAVE)) fs.rmSync(USER_SKILL_CONCLAVE, { recursive: true, force: true });
  copyDir(path.join(ROOT, '.cursor', 'skills', 'conclave'), USER_SKILL_CONCLAVE);
  if (fs.existsSync(USER_SKILL_CONCLAVE_CLI)) fs.rmSync(USER_SKILL_CONCLAVE_CLI, { recursive: true, force: true });
  copyDir(path.join(ROOT, '.cursor', 'skills', 'conclave-cli'), USER_SKILL_CONCLAVE_CLI);
}

function checkSurface(dest, expected, label) {
  const written = readInstalledManifest(dest);
  if (!written.ok) throw new Error(`${label} ${written.error}`);
  const surface = checkManifestSurface(written.manifest, expected);
  if (!surface.ok) throw new Error(`${label} ${surface.error}`);
}
function checkConclave() {
  const required = ['skills/conclave/SKILL.md', 'rules/conclave-arbiter.mdc', 'commands/conclave.md', 'agents/implementer.md'];
  const missing = required.filter((rel) => !fs.existsSync(path.join(CONCLAVE_DEST, rel)));
  if (missing.length) throw new Error(`conclave missing: ${missing.join(', ')}`);
  checkSurface(CONCLAVE_DEST, INSTALLED_CONCLAVE_SURFACE, 'conclave');
}
function checkConclaveCli(destination = CONCLAVE_CLI_DEST) {
  const paths = resolveRuntimePaths({ root: canonicalPlainPath(destination) });
  const files = new Set(regularFiles(paths.root));
  const required = [
    'skills/conclave-cli/SKILL.md',
    'skills/conclave-cli/references/cursor-cli.md',
    'skills/conclave-cli/references/dispatch-matrix.json',
    'skills/conclave-cli/references/seat-profiles.json',
    'rules/conclave-arbiter.mdc',
    'commands/conclave-cli.md',
    ...CLI_RUNTIME_TOOLS.map((name) => `tools/${name}`),
    'skill-sources.json',
  ];
  const missing = required.filter((rel) => !files.has(path.join(paths.root, rel)));
  if (missing.length) throw new Error(`conclave-cursor-cli missing: ${missing.join(', ')}`);
  for (const directory of [paths.templatesDir, paths.seatSkillsRoot]) {
    if (!fs.existsSync(directory) || !fs.lstatSync(directory).isDirectory()) throw new Error(`conclave-cursor-cli missing directory: ${directory}`);
  }
  if (fs.existsSync(path.join(paths.root, 'agents'))) throw new Error('conclave-cursor-cli must not have an agents/ directory');
  checkSurface(paths.root, INSTALLED_CONCLAVE_CLI_SURFACE, 'conclave-cursor-cli');
  const profiles = JSON.parse(fs.readFileSync(paths.seatProfilesPath, 'utf8'));
  const skills = new Set(['baseSkills', 'roleSkills', 'classSkills'].flatMap(key => Object.values(profiles[key] || {}).flat()));
  for (const skill of skills) {
    if (typeof skill !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(skill) || !files.has(path.join(paths.seatSkillsRoot, skill, 'SKILL.md'))) {
      throw new Error(`conclave-cursor-cli bundled seat skill missing or invalid: ${skill}`);
    }
  }
}

function main(argv = process.argv.slice(2)) {
  let destination;
  let checkOnly = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--destination' && destination === undefined && argv[i + 1] && !argv[i + 1].startsWith('--')) destination = argv[++i];
    else if (argv[i] === '--check' && !checkOnly) checkOnly = true;
    else throw new Error(`unknown, duplicate or incomplete installer option: ${argv[i]}`);
  }
  if (destination !== undefined) {
    if (!checkOnly) installConclaveCursorCli({ destination });
    checkConclaveCli(destination);
    console.log(`CONCLAVE Cursor CLI ${checkOnly ? 'checked' : 'installed and checked'} at ${path.resolve(destination)}`);
    return;
  }
  if (checkOnly) throw new Error('--check requires --destination; no global installation was attempted');
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  installConclaveCursor();
  installConclaveCursorCli();
  installUserGlobals();
  checkConclave();
  checkConclaveCli();
  console.log(`CONCLAVE Cursor installed at ${CONCLAVE_DEST}`);
  console.log(`CONCLAVE Cursor CLI installed at ${CONCLAVE_CLI_DEST}`);
  console.log('CONCLAVE CLI runtime is installed-relative; the source checkout is not required merely to launch seats.');
  console.log('Set CONCLAVE_RULES_ROOT to the external standing-rules pack.');
  console.log('Set CONCLAVE_VAULT_ROOT to the ai-ops-vault checkout for CONCLAVE telemetry and skill sync.');
  console.log('Reload Cursor and enable both plugins.');
}

if (require.main === module) {
  try { main(); process.exit(0); }
  catch (error) { bail(error instanceof Error ? error.message : String(error)); }
}
module.exports = {
  ROOT,
  CLI_RUNTIME_TOOLS,
  conclaveCursorManifest,
  conclaveCliManifest,
  writeManifest,
  readInstalledManifest,
  checkConclave,
  checkConclaveCli,
  installConclaveCursorCli,
  main,
};
