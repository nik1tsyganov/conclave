#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function stageError(message) {
  const error = new Error(message);
  error.code = 'SKILL_STAGE_FAIL';
  return error;
}

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function regularFiles(root, current = root, out = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw stageError(`symlink forbidden in staged skill: ${full}`);
    if (entry.isDirectory()) regularFiles(root, full, out);
    else if (entry.isFile()) out.push(full);
    else throw stageError(`unsupported filesystem entry in skill: ${full}`);
  }
  return out;
}

function copySkill(source, destination) {
  if (!fs.existsSync(path.join(source, 'SKILL.md'))) throw stageError(`skill missing SKILL.md: ${source}`);
  fs.mkdirSync(destination, { recursive: true });
  const manifest = [];
  for (const file of regularFiles(source)) {
    const rel = path.relative(source, file);
    const body = fs.readFileSync(file);
    const target = path.join(destination, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    manifest.push({ path: rel.replaceAll('\\', '/'), bytes: body.length, sha256: digest(body) });
  }
  return manifest.sort((a, b) => a.path.localeCompare(b.path));
}

function stageSeatSkills(options) {
  const skills = [...new Set(options.skills || [])];
  if (!skills.length) throw stageError('seat skill allow-list is empty');
  const home = options.home || os.homedir();
  const sourceRoot = options.sourceRoot || path.join(home, '.claude', 'skills');
  const destinationRoot = path.resolve(options.destinationRoot);
  fs.rmSync(destinationRoot, { recursive: true, force: true });
  fs.mkdirSync(destinationRoot, { recursive: true });

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceRoot,
    skills: {},
  };
  for (const skill of skills) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(skill)) throw stageError(`invalid skill name: ${skill}`);
    const source = path.join(sourceRoot, skill);
    const destination = path.join(destinationRoot, skill);
    manifest.skills[skill] = copySkill(source, destination);
  }
  const manifestPath = path.join(destinationRoot, 'skills-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { root: destinationRoot, manifestPath, manifest };
}

module.exports = { copySkill, regularFiles, stageSeatSkills, stageError };
