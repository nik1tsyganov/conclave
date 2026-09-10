#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { FORBIDDEN_ARBITER_SKILLS, copySkill, regularFiles } = require('./cli-skill-stage.js');
const { resolveRuntimePaths } = require('./runtime-paths.js');
const { ensureVaultHome, looksSecret, requireVaultRoot, vaultError } = require('./magi-vault.js');

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function listSkillNames(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => {
    if (entry.name === 'README.md' || entry.name === '.gitkeep') return false;
    return entry.isDirectory() && !entry.isSymbolicLink();
  }).map((entry) => entry.name).sort();
}

function assertSkillName(name) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(name)) throw vaultError(`invalid seat skill name: ${name}`);
  if (FORBIDDEN_ARBITER_SKILLS.includes(name)) throw vaultError(`forbidden arbiter skill cannot sync: ${name}`);
  return name;
}

function skillTree(root, name) {
  assertSkillName(name);
  const skillRoot = path.join(root, name);
  const skillMd = path.join(skillRoot, 'SKILL.md');
  if (!fs.existsSync(skillMd) || !fs.lstatSync(skillMd).isFile()) throw vaultError(`skill missing SKILL.md: ${name}`);
  const files = regularFiles(skillRoot).map((file) => {
    const relative = path.relative(skillRoot, file).replaceAll('\\', '/');
    const text = fs.readFileSync(file, 'utf8');
    if (looksSecret(text)) throw vaultError(`credential-looking content in ${name}/${relative}`);
    return { path: relative, sha256: digest(file) };
  });
  return { name, files };
}

function replaceTree(destination, names, readRoot) {
  fs.mkdirSync(destination, { recursive: true });
  for (const name of fs.readdirSync(destination)) {
    if (name === 'README.md' || name === '.gitkeep') continue;
    fs.rmSync(path.join(destination, name), { recursive: true, force: true });
  }
  for (const name of names) copySkill(path.join(readRoot, name), path.join(destination, name));
}

function magiSkillRoots(options = {}) {
  const paths = resolveRuntimePaths({ root: options.runtimeRoot });
  return { seatSkills: paths.seatSkillsRoot, seatProfiles: paths.seatProfilesPath };
}

function compareTrees(leftRoot, rightRoot) {
  const left = listSkillNames(leftRoot);
  const right = listSkillNames(rightRoot);
  const drift = [];
  for (const name of new Set([...left, ...right])) {
    if (!left.includes(name)) { drift.push({ skill: name, detail: 'missing from MAGI seat-skills' }); continue; }
    if (!right.includes(name)) { drift.push({ skill: name, detail: 'missing from vault seat-skills' }); continue; }
    const a = JSON.stringify(skillTree(leftRoot, name).files);
    const b = JSON.stringify(skillTree(rightRoot, name).files);
    if (a !== b) drift.push({ skill: name, detail: 'content hash differs' });
  }
  return { left, right, drift };
}

function syncStatus(options = {}) {
  const layout = ensureVaultHome(requireVaultRoot(options));
  const magi = magiSkillRoots(options);
  const skills = compareTrees(magi.seatSkills, layout.seatSkills);
  const inbox = listSkillNames(layout.inbox).map(assertSkillName);
  const profileDrift = fs.existsSync(layout.seatProfiles) && fs.existsSync(magi.seatProfiles)
    ? digest(layout.seatProfiles) !== digest(magi.seatProfiles)
    : !fs.existsSync(layout.seatProfiles);
  return {
    ok: skills.drift.length === 0 && !profileDrift,
    magiSkills: skills.left,
    vaultSkills: skills.right,
    inbox,
    skillDrift: skills.drift,
    profileDrift,
  };
}

function pushSkillsToVault(options = {}) {
  const layout = ensureVaultHome(requireVaultRoot(options));
  const magi = magiSkillRoots(options);
  const names = listSkillNames(magi.seatSkills).map((name) => skillTree(magi.seatSkills, name).name);
  replaceTree(layout.seatSkills, names, magi.seatSkills);
  fs.copyFileSync(magi.seatProfiles, layout.seatProfiles);
  return { ok: true, direction: 'push', skills: names, profiles: true };
}

function pullSkillsFromVault(options = {}) {
  const layout = ensureVaultHome(requireVaultRoot(options));
  const magi = magiSkillRoots(options);
  const names = listSkillNames(layout.seatSkills).map((name) => skillTree(layout.seatSkills, name).name);
  replaceTree(magi.seatSkills, names, layout.seatSkills);
  return { ok: true, direction: 'pull', skills: names, profiles: false };
}

function pullInbox(options = {}) {
  const layout = ensureVaultHome(requireVaultRoot(options));
  const magi = magiSkillRoots(options);
  const pulled = [];
  const skipped = [];
  for (const name of listSkillNames(layout.inbox)) {
    skillTree(layout.inbox, name);
    const dest = path.join(magi.seatSkills, name);
    if (fs.existsSync(dest)) {
      if (!options.force) {
        skipped.push(name);
        continue;
      }
      fs.rmSync(dest, { recursive: true, force: true });
    }
    copySkill(path.join(layout.inbox, name), dest);
    pulled.push(name);
  }
  return { ok: true, direction: 'pull-inbox', pulled, skipped };
}

function main(argv = process.argv.slice(2), io = process) {
  try {
    const command = argv[0];
    if (argv.length !== 1 || !['--status', '--push', '--pull', '--pull-inbox'].includes(command)) {
      throw vaultError('Usage: magi-vault-sync.js --status|--push|--pull|--pull-inbox');
    }
    const result = command === '--status' ? syncStatus()
      : command === '--push' ? pushSkillsToVault()
        : command === '--pull' ? pullSkillsFromVault()
          : pullInbox();
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok === false ? 1 : 0;
  } catch (error) {
    io.stderr.write(`VAULT_SYNC_FAIL: ${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { listSkillNames, main, pullInbox, pullSkillsFromVault, pushSkillsToVault, syncStatus };
