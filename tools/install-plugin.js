#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CLI_RUNTIME_TOOLS, canonicalPlainPath, pathsOverlap, resolveRuntimePaths } = require('./runtime-paths.js');
const { regularFiles } = require('./cli-skill-stage.js');
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
      const surface = manifest.name === 'magi-cursor-cli' ? INSTALLED_MAGI_CLI_SURFACE : INSTALLED_MAGI_SURFACE;
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
  return writeInstall(prepareInstall(ROOT, MAGI_DEST, magiCursorManifest(), [
    ['.cursor/skills', 'skills'], ['.cursor/rules', 'rules'], ['agents', 'agents'],
    ['tools', 'tools'], ['seat-skills', 'seat-skills'],
    ['commands/magi.md', 'commands/magi.md'], ['commands/magi-cli.md', 'commands/magi-cli.md'],
  ]));
}

function validateCliFiles(files) {
  for (const required of ['skills/magi-cli/SKILL.md', 'skills/magi-cli/references/cursor-cli.md',
    'skills/magi-cli/references/dispatch-matrix.json', 'skills/magi-cli/references/seat-profiles.json',
    'rules/magi-arbiter.mdc']) {
    if (!files.has(required)) throw new Error(`installer source missing required file: ${required}`);
  }
  const profiles = JSON.parse(files.get('skills/magi-cli/references/seat-profiles.json').toString('utf8'));
  const skills = new Set(['baseSkills', 'roleSkills', 'classSkills'].flatMap(key => Object.values(profiles[key] || {}).flat()));
  for (const skill of skills) {
    if (typeof skill !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(skill) || !files.has(`seat-skills/${skill}/SKILL.md`)) {
      throw new Error(`installer source missing bundled seat skill: ${skill}`);
    }
  }
}

function installMagiCursorCli({ destination = MAGI_CLI_DEST, sourceRoot = ROOT } = {}) {
  const prepared = prepareInstall(sourceRoot, destination, magiCliManifest(), [
    ['.cursor/skills/magi-cli', 'skills/magi-cli'], ['.cursor/rules', 'rules'],
    ['commands/magi-cli.md', 'commands/magi-cli.md'], ['tools/templates', 'tools/templates'],
    ['seat-skills', 'seat-skills'], ...CLI_RUNTIME_TOOLS.map(tool => [`tools/${tool}`, `tools/${tool}`]),
  ], validateCliFiles);
  return writeInstall(prepared);
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
function checkMagiCli(destination = MAGI_CLI_DEST) {
  const paths = resolveRuntimePaths({ root: canonicalPlainPath(destination) });
  const files = new Set(regularFiles(paths.root));
  const required = [
    'skills/magi-cli/SKILL.md',
    'skills/magi-cli/references/cursor-cli.md',
    'skills/magi-cli/references/dispatch-matrix.json',
    'skills/magi-cli/references/seat-profiles.json',
    'rules/magi-arbiter.mdc',
    'commands/magi-cli.md',
    ...CLI_RUNTIME_TOOLS.map((name) => `tools/${name}`),
  ];
  const missing = required.filter((rel) => !files.has(path.join(paths.root, rel)));
  if (missing.length) throw new Error(`magi-cursor-cli missing: ${missing.join(', ')}`);
  for (const directory of [paths.templatesDir, paths.seatSkillsRoot]) {
    if (!fs.existsSync(directory) || !fs.lstatSync(directory).isDirectory()) throw new Error(`magi-cursor-cli missing directory: ${directory}`);
  }
  if (fs.existsSync(path.join(paths.root, 'agents'))) throw new Error('magi-cursor-cli must not have an agents/ directory');
  checkSurface(paths.root, INSTALLED_MAGI_CLI_SURFACE, 'magi-cursor-cli');
  const profiles = JSON.parse(fs.readFileSync(paths.seatProfilesPath, 'utf8'));
  const skills = new Set(['baseSkills', 'roleSkills', 'classSkills'].flatMap(key => Object.values(profiles[key] || {}).flat()));
  for (const skill of skills) {
    if (typeof skill !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(skill) || !files.has(path.join(paths.seatSkillsRoot, skill, 'SKILL.md'))) {
      throw new Error(`magi-cursor-cli bundled seat skill missing or invalid: ${skill}`);
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
    if (!checkOnly) installMagiCursorCli({ destination });
    checkMagiCli(destination);
    console.log(`MAGI Cursor CLI ${checkOnly ? 'checked' : 'installed and checked'} at ${path.resolve(destination)}`);
    return;
  }
  if (checkOnly) throw new Error('--check requires --destination; no global installation was attempted');
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  installMagiCursor();
  installMagiCursorCli();
  installUserGlobals();
  checkMagi();
  checkMagiCli();
  console.log(`MAGI Cursor installed at ${MAGI_DEST}`);
  console.log(`MAGI Cursor CLI installed at ${MAGI_CLI_DEST}`);
  console.log('MAGI CLI runtime is installed-relative; C:\\src\\magi is no longer required merely to launch seats.');
  console.log('Set MAGI_RULES_ROOT to the external standing-rules pack.');
  console.log('Reload Cursor and enable both plugins.');
}

if (require.main === module) {
  try { main(); process.exit(0); }
  catch (error) { bail(error instanceof Error ? error.message : String(error)); }
}
module.exports = {
  ROOT,
  CLI_RUNTIME_TOOLS,
  magiCursorManifest,
  magiCliManifest,
  writeManifest,
  readInstalledManifest,
  checkMagi,
  checkMagiCli,
  installMagiCursorCli,
  main,
};
