#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FINGERPRINT = 'MAGI-CLI-STANDING v1 — Read this file in full; repeat this line verbatim before any other work.';
const DEFAULT_RULES_ROOT = 'C:\\src\\ai-ops-vault\\projects\\magi-cli-rules';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function listRuleFiles(rulesDir) {
  const names = fs.readdirSync(rulesDir).filter((name) => /^R\d{2}-.*\.md$/.test(name)).sort();
  const ids = new Set(names.map((name) => name.slice(0, 3)));
  const missing = [];
  for (let i = 1; i <= 21; i += 1) {
    const id = `R${String(i).padStart(2, '0')}`;
    if (!ids.has(id)) missing.push(id);
  }
  if (missing.length) throw new Error(`rules pack missing ${missing.join(', ')}`);
  return names;
}

function stageRules({ briefPath, rulesRoot = process.env.MAGI_RULES_ROOT || DEFAULT_RULES_ROOT }) {
  const root = path.resolve(rulesRoot);
  const standing = path.join(root, 'STANDING.md');
  const vendor = path.join(root, 'VENDOR.md');
  const rules = path.join(root, 'RULES');
  for (const required of [standing, vendor, path.join(rules, 'INDEX.md')]) {
    if (!fs.existsSync(required)) {
      const error = new Error(`standing-rules source missing: ${required}`);
      error.code = 'RULES_SOURCE_MISSING';
      throw error;
    }
  }
  const firstLine = fs.readFileSync(standing, 'utf8').split(/\r?\n/, 1)[0];
  if (firstLine !== FINGERPRINT) {
    const error = new Error(`STANDING.md fingerprint mismatch: ${JSON.stringify(firstLine)}`);
    error.code = 'RULES_FINGERPRINT_MISMATCH';
    throw error;
  }
  const ruleFiles = listRuleFiles(rules);
  const briefDir = path.dirname(path.resolve(briefPath));
  const stagedRules = path.join(briefDir, 'RULES');
  fs.rmSync(stagedRules, { recursive: true, force: true });
  fs.mkdirSync(stagedRules, { recursive: true });
  copyFile(path.join(rules, 'INDEX.md'), path.join(stagedRules, 'INDEX.md'));
  for (const name of ruleFiles) copyFile(path.join(rules, name), path.join(stagedRules, name));
  copyFile(standing, path.join(briefDir, 'STANDING.md'));
  copyFile(vendor, path.join(briefDir, 'VENDOR.md'));
  const manifest = {
    version: 1,
    fingerprint: FINGERPRINT,
    sourceRoot: root,
    files: [
      'STANDING.md', 'VENDOR.md', 'RULES/INDEX.md', ...ruleFiles.map((name) => `RULES/${name}`),
    ].map((rel) => ({ path: rel, sha256: sha256(path.join(briefDir, ...rel.split('/'))) })),
  };
  const manifestPath = path.join(briefDir, 'rules-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { briefDir, rulesRoot: root, stagedRules, manifestPath, manifest };
}

function verifyStagedRules(briefPath) {
  const briefDir = path.dirname(path.resolve(briefPath));
  const manifestPath = path.join(briefDir, 'rules-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`rules manifest missing: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.fingerprint !== FINGERPRINT) throw new Error('rules manifest fingerprint mismatch');
  for (const file of manifest.files || []) {
    const full = path.join(briefDir, ...file.path.split('/'));
    if (!fs.existsSync(full)) throw new Error(`staged rule missing: ${file.path}`);
    if (sha256(full) !== file.sha256) throw new Error(`staged rule hash mismatch: ${file.path}`);
  }
  if ((manifest.files || []).filter((f) => /^RULES\/R\d{2}-/.test(f.path)).length < 21) throw new Error('staged rules pack incomplete');
  return manifest;
}

function main(argv = process.argv.slice(2), io = process) {
  try {
    const briefIndex = argv.indexOf('--brief');
    const rootIndex = argv.indexOf('--rules-root');
    if (briefIndex === -1 || !argv[briefIndex + 1]) throw new Error('--brief is required');
    const result = stageRules({ briefPath: argv[briefIndex + 1], rulesRoot: rootIndex === -1 ? undefined : argv[rootIndex + 1] });
    io.stdout.write(`${JSON.stringify({ ok: true, manifest: result.manifestPath })}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`RULES_STAGE_FAIL: ${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { DEFAULT_RULES_ROOT, FINGERPRINT, listRuleFiles, stageRules, verifyStagedRules };
