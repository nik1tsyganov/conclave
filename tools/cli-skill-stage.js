#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { canonicalPlainPath, pathsOverlap, resolveRuntimePaths } = require('./runtime-paths.js');

const FORBIDDEN_ARBITER_SKILLS = Object.freeze([
  'engineering-orchestrator', 'graph-engineering', 'magi-mode', 'magi-dispatch',
  'mix-mode', 'dispatch-efficiency', 'dispatch-assessment', 'task-retrospective',
  'codex-bridge', 'gemini-bridge', 'claude-bridge',
]);

function stageError(message) { return Object.assign(new Error(message), { code: 'SKILL_STAGE_FAIL' }); }
function verifyError(message) { return Object.assign(new Error(message), { code: 'SKILL_VERIFY_FAIL' }); }
function digest(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function allowedSkills(skills) {
  if (!Array.isArray(skills) || !skills.length) throw stageError('seat skill allow-list is empty or invalid');
  for (const skill of skills) {
    if (typeof skill !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(skill)) throw stageError('invalid skill name: ' + skill);
    if (FORBIDDEN_ARBITER_SKILLS.includes(skill)) throw stageError('forbidden arbiter skill in seat allow-list: ' + skill);
  }
  return [...new Set(skills)];
}

function safeRelativePath(file) {
  return typeof file === 'string' && file.length > 0 && !/[\\:<>"|?*\x00-\x1f\x7f]/.test(file) &&
    file.split('/').every(segment => segment && segment !== '.' && segment !== '..' && !/[. ]$/.test(segment) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment));
}

function regularFiles(root, current = root, out = [], directories = []) {
  if (current === root) canonicalPlainPath(root);
  const stat = fs.lstatSync(current);
  if (stat.isSymbolicLink()) throw stageError('symlink forbidden in staged skill: ' + current);
  if (!stat.isDirectory()) throw stageError('skill path is not a directory: ' + current);
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw stageError('symlink forbidden in staged skill: ' + full);
    if (entry.isDirectory()) {
      directories.push(full);
      regularFiles(root, full, out, directories);
    } else if (entry.isFile()) out.push(full);
    else throw stageError('unsupported filesystem entry in skill: ' + full);
  }
  return out;
}

function readSkill(source) {
  const files = regularFiles(source).map(file => ({ path: path.relative(source, file).replaceAll('\\', '/'), body: fs.readFileSync(file) }));
  const instruction = files.find(file => file.path === 'SKILL.md');
  if (!instruction) throw stageError('skill missing SKILL.md: ' + source);
  if (!instruction.body.toString('utf8').trim()) throw stageError('required SKILL.md is empty: ' + source);
  const seen = new Set();
  for (const file of files) {
    if (!safeRelativePath(file.path) || seen.has(file.path.toLowerCase())) throw stageError('unsafe or duplicate skill path: ' + file.path);
    seen.add(file.path.toLowerCase());
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function writeSkill(files, destination) {
  const manifest = [];
  for (const file of files) {
    const target = path.join(destination, ...file.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.body);
    manifest.push({ path: file.path, bytes: file.body.length, sha256: digest(file.body) });
  }
  return manifest;
}

function skillFileHashes(files) {
  return files.map(file => ({ path: file.path, bytes: file.body.length, sha256: digest(file.body) }));
}

function bindSkillSource({ sourceRoot = resolveRuntimePaths().seatSkillsRoot, skills }) {
  sourceRoot = canonicalPlainPath(sourceRoot);
  return { sourceRoot, skills: Object.fromEntries(allowedSkills(skills).sort().map(skill =>
    [skill, skillFileHashes(readSkill(path.join(sourceRoot, skill)))])) };
}

function verifySkillSource(binding, sourceRoot = binding?.sourceRoot) {
  if (!binding || !binding.skills || !isDeepStrictEqual(binding,
    bindSkillSource({ sourceRoot, skills: Object.keys(binding.skills) }))) {
    throw stageError('skill source differs from sealed identity or content');
  }
  return binding;
}

function copySkill(source, destination) {
  const from = canonicalPlainPath(source);
  const to = canonicalPlainPath(destination);
  if (pathsOverlap(from, to)) throw stageError('skill source and destination overlap');
  return writeSkill(readSkill(from), to);
}

function prepareSeatSkills(options = {}) {
  try {
    const skills = allowedSkills(options.skills);
    const sourceRoot = canonicalPlainPath(options.sourceRoot || resolveRuntimePaths().seatSkillsRoot);
    const destinationRoot = canonicalPlainPath(options.destinationRoot);
    if (pathsOverlap(sourceRoot, destinationRoot)) throw stageError('skill source and destination overlap; refusing to delete the source');
    const prepared = skills.map(skill => ({ skill, files: readSkill(path.join(sourceRoot, skill)) }));
    if (options.sourceBinding && (sourceRoot !== options.sourceBinding.sourceRoot || prepared.some(entry =>
      !isDeepStrictEqual(skillFileHashes(entry.files), options.sourceBinding.skills?.[entry.skill])))) {
      throw stageError('skill source differs from sealed identity or content');
    }
    if (fs.existsSync(destinationRoot)) {
      if (!fs.lstatSync(destinationRoot).isDirectory()) throw stageError('skill destination is not a directory');
      if (fs.readdirSync(destinationRoot).length) {
        let previous;
        try { previous = JSON.parse(fs.readFileSync(path.join(destinationRoot, 'skills-manifest.json'), 'utf8')); }
        catch { throw stageError('refusing to replace an unrelated skill destination'); }
        verifySeatSkills({ destinationRoot, skills: Object.keys(previous.skills || {}), manifest: previous });
      }
    }
    return { sourceRoot, destinationRoot, prepared };
  } catch (error) {
    if (error.code === 'SKILL_STAGE_FAIL') throw error;
    throw stageError(error.message);
  }
}

function stageSeatSkills(options = {}) {
  try {
    const { sourceRoot, destinationRoot, prepared } = prepareSeatSkills(options);
    fs.rmSync(destinationRoot, { recursive: true, force: true });
    fs.mkdirSync(destinationRoot, { recursive: true });
    const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), sourceRoot, skills: {} };
    for (const entry of prepared) manifest.skills[entry.skill] = writeSkill(entry.files, path.join(destinationRoot, entry.skill));
    const manifestPath = path.join(destinationRoot, 'skills-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    return { root: destinationRoot, manifestPath, manifest };
  } catch (error) {
    if (error.code === 'SKILL_STAGE_FAIL') throw error;
    throw stageError(error.message);
  }
}

// The caller retains the original manifest in memory before the child runs.
function verifySeatSkills({ destinationRoot, skills, manifest }) {
  try {
    const expectedSkills = allowedSkills(skills);
    if (!manifest || manifest.schemaVersion !== 1 || !Number.isFinite(Date.parse(manifest.generatedAt)) ||
        typeof manifest.sourceRoot !== 'string' || !manifest.sourceRoot || !manifest.skills || Array.isArray(manifest.skills) ||
        typeof manifest.skills !== 'object') throw verifyError('seat skill manifest is missing or malformed');
    if (!isDeepStrictEqual(Object.keys(manifest.skills).sort(), [...expectedSkills].sort())) throw verifyError('staged skill set does not match the expected allow-list');
    const root = canonicalPlainPath(destinationRoot);
    if (!fs.lstatSync(root).isDirectory()) throw verifyError('staged skill root is not a directory');
    const rootEntries = fs.readdirSync(root, { withFileTypes: true });
    const rootNames = new Set([...expectedSkills, 'skills-manifest.json']);
    for (const entry of rootEntries) {
      if (entry.isSymbolicLink()) throw verifyError('symlink forbidden at staged skill root: ' + entry.name);
      if (!rootNames.has(entry.name)) throw verifyError('unexpected entry at staged skill root: ' + entry.name);
      if (entry.name === 'skills-manifest.json' ? !entry.isFile() : !entry.isDirectory()) throw verifyError('unexpected entry type: ' + entry.name);
    }
    const disk = JSON.parse(fs.readFileSync(path.join(root, 'skills-manifest.json'), 'utf8'));
    if (!isDeepStrictEqual(disk, manifest)) throw verifyError('staged skills manifest differs from the trusted original manifest');
    for (const skill of expectedSkills) {
      const entries = manifest.skills[skill];
      if (!Array.isArray(entries) || !entries.length) throw verifyError('skill ' + skill + ' has no manifest entries');
      const wantedFiles = new Set();
      const foldedFiles = new Set();
      const wantedDirectories = new Set();
      for (const entry of entries) {
        if (!entry || !safeRelativePath(entry.path) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
            typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw verifyError('skill ' + skill + ' has an unsafe or malformed manifest entry');
        if (foldedFiles.has(entry.path.toLowerCase())) throw verifyError('skill ' + skill + ' has a duplicate manifest path: ' + entry.path);
        wantedFiles.add(entry.path);
        foldedFiles.add(entry.path.toLowerCase());
        const segments = entry.path.split('/');
        for (let i = 1; i < segments.length; i += 1) wantedDirectories.add(segments.slice(0, i).join('/'));
      }
      if (!wantedFiles.has('SKILL.md')) throw verifyError('skill ' + skill + ' manifest has no SKILL.md');
      const skillDir = path.join(root, skill);
      const directories = [];
      const relative = file => path.relative(skillDir, file).replaceAll('\\', '/');
      const files = regularFiles(skillDir, skillDir, [], directories);
      if (!isDeepStrictEqual(files.map(relative).sort(), [...wantedFiles].sort())) throw verifyError('staged skill file set mismatch: ' + skill);
      if (!isDeepStrictEqual(directories.map(relative).sort(), [...wantedDirectories].sort())) throw verifyError('staged skill directory set mismatch: ' + skill);
      for (const entry of entries) {
        const body = fs.readFileSync(path.join(skillDir, ...entry.path.split('/')));
        if (body.length !== entry.bytes || digest(body) !== entry.sha256) throw verifyError('staged skill file hash or byte count mismatch: ' + skill + '/' + entry.path);
      }
    }
    return { ok: true, skills: expectedSkills };
  } catch (error) {
    if (error.code === 'SKILL_VERIFY_FAIL') throw error;
    throw verifyError(error.message);
  }
}

module.exports = { FORBIDDEN_ARBITER_SKILLS, bindSkillSource, copySkill, prepareSeatSkills, regularFiles, stageError, stageSeatSkills, verifySeatSkills, verifySkillSource };
