#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalPlainPath, resolveRulesRoot } = require('./runtime-paths.js');

const FINGERPRINT = 'MAGI-CLI-STANDING v1 — Read this file in full; repeat this line verbatim before any other work.';
// Trusted, version-adaptable: parent adds each new pack's exact fingerprint line
// here as the standing-rules pack revs; never widen this to a pattern/regex.
const FINGERPRINT_V2 = 'MAGI-CLI-STANDING v2 — Read this file and RULES/INDEX.md in full before task work.';
const TRUSTED_FINGERPRINTS = Object.freeze([FINGERPRINT, FINGERPRINT_V2]);
const DEFAULT_RULES_ROOT = null;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function listRuleFiles(rulesDir) {
  const names = fs.readdirSync(rulesDir).filter((name) => /^R\d{2}-.*\.md$/.test(name)).sort();
  const seen = new Map();
  for (const name of names) {
    const id = name.slice(0, 3);
    if (seen.has(id)) throw new Error(`rules pack has duplicate rule ID ${id}: ${seen.get(id)} and ${name}`);
    seen.set(id, name);
  }
  const missing = [];
  for (let i = 1; i <= 21; i += 1) {
    const id = `R${String(i).padStart(2, '0')}`;
    if (!seen.has(id)) missing.push(id);
  }
  if (missing.length) throw new Error(`rules pack missing ${missing.join(', ')}`);
  return names;
}

function prepareRulesSource({ rulesRoot }) {
  let root;
  try { root = resolveRulesRoot({ rulesRoot, defaultRulesRoot: DEFAULT_RULES_ROOT }); }
  catch (error) { error.code = 'RULES_SOURCE_MISSING'; throw error; }
  const standing = path.join(root, 'STANDING.md');
  const vendor = path.join(root, 'VENDOR.md');
  const rules = path.join(root, 'RULES');
  for (const required of [standing, vendor, path.join(rules, 'INDEX.md')]) {
    if (!fs.existsSync(required)) {
      const error = new Error(
        `standing-rules pack missing ${required}; set MAGI_RULES_ROOT (or pass rulesRoot) to an external standing-rules pack, currently resolved to ${root}`,
      );
      error.code = 'RULES_SOURCE_MISSING';
      throw error;
    }
  }
  root = canonicalPlainPath(root);
  const firstLine = fs.readFileSync(standing, 'utf8').split(/\r?\n/, 1)[0];
  if (!TRUSTED_FINGERPRINTS.includes(firstLine)) {
    const error = new Error(`STANDING.md fingerprint mismatch: ${JSON.stringify(firstLine)}`);
    error.code = 'RULES_FINGERPRINT_MISMATCH';
    throw error;
  }
  const ruleFiles = listRuleFiles(rules);
  if (firstLine === FINGERPRINT_V2 && !ruleFiles.some((name) => name.startsWith('R22-'))) throw new Error('rules pack missing R22');
  if (firstLine === FINGERPRINT_V2 && ruleFiles.length !== 22) throw new Error('v2 rules pack must contain exactly R01-R22');
  for (const source of [root, rules, standing, vendor, path.join(rules, 'INDEX.md'), ...ruleFiles.map((name) => path.join(rules, name))]) {
    if (fs.lstatSync(source).isSymbolicLink()) throw new Error('rules source must not contain symbolic links');
    if (source !== root && source !== rules) {
      if (!fs.lstatSync(source).isFile()) throw new Error(`rule source must be a regular file: ${source}`);
      if (!fs.readFileSync(source, 'utf8').trim()) throw new Error(`required rule content is empty: ${source}`);
    }
  }
  return { root, standing, vendor, rules, ruleFiles, fingerprint: firstLine };
}

function stageRules({ briefPath, rulesRoot }) {
  const { root, standing, vendor, rules, ruleFiles, fingerprint: firstLine } = prepareRulesSource({ rulesRoot });
  const briefDir = fs.realpathSync(path.dirname(path.resolve(briefPath)));
  const stagedRules = path.join(briefDir, 'RULES');
  const sourceRoot = fs.realpathSync(root);
  const isInside = (file, parent) => { const rel = path.relative(parent, file); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); };
  if (isInside(stagedRules, sourceRoot) || isInside(sourceRoot, stagedRules)) throw new Error('rules source and staging directory must not overlap');
  for (const target of [stagedRules, path.join(briefDir, 'STANDING.md'), path.join(briefDir, 'VENDOR.md'), path.join(briefDir, 'rules-manifest.json')]) {
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('rules staging targets must not be symbolic links');
  }
  fs.rmSync(stagedRules, { recursive: true, force: true });
  fs.mkdirSync(stagedRules, { recursive: true });
  copyFile(path.join(rules, 'INDEX.md'), path.join(stagedRules, 'INDEX.md'));
  for (const name of ruleFiles) copyFile(path.join(rules, name), path.join(stagedRules, name));
  copyFile(standing, path.join(briefDir, 'STANDING.md'));
  copyFile(vendor, path.join(briefDir, 'VENDOR.md'));
  const files = [
    'STANDING.md', 'VENDOR.md', 'RULES/INDEX.md', ...ruleFiles.map((name) => `RULES/${name}`),
  ].map((rel) => ({ path: rel, sha256: sha256(path.join(briefDir, ...rel.split('/'))) }));
  // Bundle (manifest v2, 2026-09-16): one staged file carries every rule file
  // verbatim, so a seat performs one native read instead of twenty-five. The
  // individual files stay staged for link resolution and hashing.
  const bundlePath = path.join(briefDir, BUNDLE_NAME);
  if (fs.existsSync(bundlePath) && fs.lstatSync(bundlePath).isSymbolicLink()) throw new Error('rules staging targets must not be symbolic links');
  fs.writeFileSync(bundlePath, bundleText(briefDir, files), 'utf8');
  const manifest = {
    version: 2,
    fingerprint: firstLine,
    sourceRoot: root,
    files,
    bundle: { path: BUNDLE_NAME, sha256: sha256(bundlePath), covers: files.map((file) => file.path) },
  };
  const manifestPath = path.join(briefDir, 'rules-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { briefDir, rulesRoot: root, stagedRules, manifestPath, manifest };
}

const BUNDLE_NAME = 'RULES-BUNDLE.md';

// Deterministic bundle text: a header, then every staged file in manifest order
// under a marker line naming the file and its hash. Recomputed on verification
// from the hash-checked staged files, so a bundle can never say something the
// files do not.
function bundleText(briefDir, files) {
  const parts = [`<!-- MAGI staged rules bundle. Reading this file in full counts as reading every file listed below; each section is that staged file verbatim. -->`];
  for (const file of files) {
    const body = fs.readFileSync(path.join(briefDir, ...file.path.split('/')), 'utf8');
    parts.push(`\n<!-- === staged file: ${file.path} sha256: ${file.sha256} === -->\n${body}${body.endsWith('\n') ? '' : '\n'}`);
  }
  return parts.join('\n');
}

function unsafeManifestPath(rel) {
  if (typeof rel !== 'string' || rel.length === 0) return true;
  if (path.isAbsolute(rel) || /[\\:\x00-\x1f]/.test(rel)) return true;
  return rel.split('/').some((segment) => segment === '' || segment === '..' || segment === '.');
}

// Structural completeness check applied to whichever manifest is trusted for a
// given call: the caller-held object when supplied, otherwise the on-disk file.
// Never derives trust from a manifest an attacker could have rewritten on disk.
function validateManifestShape(manifest, label) {
  if (!manifest || typeof manifest !== 'object') throw new Error(`${label} is not an object`);
  if (!TRUSTED_FINGERPRINTS.includes(manifest.fingerprint)) throw new Error(`${label} fingerprint mismatch`);
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error(`${label} has no files`);
  const seenPaths = new Set();
  const ruleIds = new Map();
  let hasStanding = false;
  let hasVendor = false;
  let hasIndex = false;
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || typeof file.sha256 !== 'string') {
      throw new Error(`${label} has a malformed entry`);
    }
    if (!/^[a-f0-9]{64}$/i.test(file.sha256)) throw new Error(`${label} has an invalid sha256: ${file.path}`);
    if (unsafeManifestPath(file.path)) throw new Error(`${label} has an unsafe path: ${file.path}`);
    if (seenPaths.has(file.path)) throw new Error(`${label} has a duplicate path: ${file.path}`);
    seenPaths.add(file.path);
    if (file.path === 'STANDING.md') { hasStanding = true; continue; }
    if (file.path === 'VENDOR.md') { hasVendor = true; continue; }
    if (file.path === 'RULES/INDEX.md') { hasIndex = true; continue; }
    const match = /^RULES\/(R\d{2})-[^/]+\.md$/.exec(file.path);
    if (!match) throw new Error(`${label} has an unexpected entry: ${file.path}`);
    if (ruleIds.has(match[1])) throw new Error(`${label} has a duplicate rule ID: ${match[1]}`);
    ruleIds.set(match[1], file.path);
  }
  if (!hasStanding) throw new Error(`${label} is missing STANDING.md`);
  if (!hasVendor) throw new Error(`${label} is missing VENDOR.md`);
  if (!hasIndex) throw new Error(`${label} is missing RULES/INDEX.md`);
  for (let i = 1; i <= (manifest.fingerprint === FINGERPRINT_V2 ? 22 : 21); i += 1) {
    const id = `R${String(i).padStart(2, '0')}`;
    if (!ruleIds.has(id)) throw new Error(`${label} is missing ${id}`);
  }
  if (manifest.fingerprint === FINGERPRINT_V2 && ruleIds.size !== 22) throw new Error(`${label} must contain exactly R01-R22`);
  if (manifest.version === 2 || manifest.bundle !== undefined) {
    const bundle = manifest.bundle;
    if (!bundle || bundle.path !== BUNDLE_NAME || !/^[a-f0-9]{64}$/i.test(String(bundle.sha256 || ''))) throw new Error(`${label} has a malformed bundle entry`);
    const covers = JSON.stringify([...(bundle.covers || [])].sort());
    if (covers !== JSON.stringify(manifest.files.map((file) => file.path).sort())) throw new Error(`${label} bundle does not cover the staged file set`);
  }
}

function verifyStagedRules(briefPath, expectedManifest) {
  const briefDir = path.dirname(path.resolve(briefPath));
  const manifestPath = path.join(briefDir, 'rules-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`rules manifest missing: ${manifestPath}`);
  let onDisk;
  try {
    onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`rules manifest is not valid JSON: ${error.message}`);
  }
  validateManifestShape(onDisk, 'rules manifest');

  const trusted = expectedManifest || onDisk;
  if (expectedManifest) {
    validateManifestShape(expectedManifest, 'expected rules manifest');
    const trustedPaths = JSON.stringify([...trusted.files].map((f) => f.path).sort());
    const onDiskPaths = JSON.stringify([...onDisk.files].map((f) => f.path).sort());
    if (trustedPaths !== onDiskPaths) throw new Error('rules manifest file set does not match the expected pack');
    if (JSON.stringify(onDisk) !== JSON.stringify(expectedManifest)) throw new Error('rules manifest changed after staging');
  }

  // Hashes and existence are always recomputed from disk against the trusted
  // manifest, never against the (writable) on-disk manifest's own claims.
  for (const file of trusted.files) {
    const full = path.join(briefDir, ...file.path.split('/'));
    const stat = fs.existsSync(full) ? fs.lstatSync(full) : null;
    if (!stat) throw new Error(`staged rule missing: ${file.path}`);
    if (!stat.isFile()) throw new Error(`staged rule is not a regular file: ${file.path}`);
    if (sha256(full) !== file.sha256) throw new Error(`staged rule hash mismatch: ${file.path}`);
  }
  if (trusted.bundle) {
    const bundlePath = path.join(briefDir, trusted.bundle.path);
    const stat = fs.existsSync(bundlePath) ? fs.lstatSync(bundlePath) : null;
    if (!stat || !stat.isFile()) throw new Error('staged rules bundle missing');
    if (sha256(bundlePath) !== trusted.bundle.sha256) throw new Error('staged rules bundle hash mismatch');
    if (fs.readFileSync(bundlePath, 'utf8') !== bundleText(briefDir, trusted.files)) throw new Error('staged rules bundle differs from the staged files');
  }
  const expectedRules = trusted.files.filter((file) => file.path.startsWith('RULES/')).map((file) => file.path.slice(6)).sort();
  if (JSON.stringify(fs.readdirSync(path.join(briefDir, 'RULES')).sort()) !== JSON.stringify(expectedRules)) throw new Error('unexpected or missing staged rule files');
  if (fs.readFileSync(path.join(briefDir, 'STANDING.md'), 'utf8').split(/\r?\n/, 1)[0] !== trusted.fingerprint) throw new Error('staged STANDING fingerprint differs from manifest');
  return trusted;
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
module.exports = { DEFAULT_RULES_ROOT, FINGERPRINT, FINGERPRINT_V2, TRUSTED_FINGERPRINTS, listRuleFiles, prepareRulesSource, stageRules, verifyStagedRules, BUNDLE_NAME, bundleText };
