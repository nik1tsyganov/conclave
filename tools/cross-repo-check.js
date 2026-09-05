#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadProfiles } = require('./seat-policy.js');
const { FINGERPRINT_V2 } = require('./cli-rules-stage.js');
const { regularFiles } = require('./cli-skill-stage.js');
const { resolveRuntimePaths } = require('./runtime-paths.js');
const { checkBriefTemplate } = require('./plugin-check.js');
const { ROLES } = require('./dispatch-schema.js');

const VENDORS = ['openai', 'anthropic', 'google'];
const RULE_IDS = Array.from({ length: 22 }, (_, i) => `R${String(i + 1).padStart(2, '0')}`);
function fail(message) { throw Object.assign(new Error(message), { code: 'CROSS_REPO_FAIL' }); }
function read(file) {
  if (!fs.lstatSync(file).isFile()) fail(`not a regular file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}
function readJson(file) { try { return JSON.parse(read(file)); } catch (error) { fail(`cannot read ${file}: ${error.message}`); } }
function same(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.every((x) => typeof x === 'string') && b.every((x) => typeof x === 'string') &&
    new Set(a).size === a.length && new Set(b).size === b.length && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}
function keys(value) { return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : []; }
function skills(value) { return Array.isArray(value) && value.every((item) => typeof item === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(item)); }
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function skillInventory(root, required) {
  if (!fs.lstatSync(root).isDirectory()) fail(`skill source is not a directory: ${root}`);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  if (!same(entries.map((entry) => entry.name), required) || entries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())) {
    fail(`skill directory set differs from the allow-list: ${root}`);
  }
  for (const skill of required) if (!read(path.join(root, skill, 'SKILL.md')).trim()) fail(`empty skill file: ${skill}`);
  return regularFiles(root).map((file) => [path.relative(root, file).replaceAll('\\', '/'), hash(file)]).sort((a, b) => a[0].localeCompare(b[0]));
}

function check(options = {}) {
  const env = options.env || process.env;
  const kitOption = options.kitRoot || env.MAGI_KIT_ROOT;
  const vaultOption = options.vaultRoot || env.MAGI_RULES_ROOT;
  if (!kitOption) fail('explicit kit root required: --kit-root or MAGI_KIT_ROOT');
  if (!vaultOption) fail('explicit rules root required: --vault-root or MAGI_RULES_ROOT');
  const kitRoot = path.resolve(kitOption);
  const vaultRoot = path.resolve(vaultOption);
  const runtime = resolveRuntimePaths({ root: options.runtimeRoot });
  const profiles = loadProfiles(options.seatProfiles || runtime.seatProfilesPath);
  const matrix = readJson(runtime.matrixPath);
  const kit = readJson(path.join(kitRoot, 'magi', 'seat-skills.json'));
  const findings = [];
  function record(name, ok, observed) { findings.push({ check: name, ok: Boolean(ok), ...(observed === undefined ? {} : { observed }) }); }
  function checked(name, fn) {
    try { const result = fn(); record(name, result.ok, result.observed); }
    catch (error) { record(name, false, error.message); }
  }
  for (const [name, left, right, expected] of [
    ['base', profiles.baseSkills, kit.baseSkills, VENDORS],
    ['role', profiles.roleSkills, kit.roles, ROLES],
    ['class', profiles.classSkills, kit.classes, keys(matrix.classes)],
  ]) {
    record(`kit-${name}-keys`, same(keys(left), expected) && same(keys(right), expected));
    for (const key of new Set([...keys(left), ...keys(right), ...expected])) {
      record(`kit-${name}:${key}`, skills(left?.[key]) && skills(right?.[key]) && same(left[key], right[key]));
    }
  }
  record('kit-forbidden-skills', skills(profiles.forbiddenSeatSkills) && skills(kit.arbiterOnly) && same(profiles.forbiddenSeatSkills, kit.arbiterOnly));
  const selected = [...new Set([profiles.baseSkills, profiles.roleSkills, profiles.classSkills]
    .flatMap((map) => keys(map).flatMap((key) => skills(map[key]) ? map[key] : [])))].sort();
  const overlap = selected.filter((skill) => profiles.forbiddenSeatSkills?.includes(skill) || kit.arbiterOnly?.includes(skill));
  record('kit-arbiter-separation', selected.length > 0 && overlap.length === 0, overlap);
  record('kit-shared-stage-source', kit.sharedStageSource === 'magi/skills', kit.sharedStageSource);
  let sourceFiles;
  checked('kit-skill-files', () => {
    sourceFiles = skillInventory(path.join(kitRoot, 'magi', 'skills'), selected);
    return { ok: true, observed: sourceFiles.length };
  });
  checked('runtime-kit-skill-files', () => {
    const bundled = skillInventory(path.join(runtime.root, 'seat-skills'), selected);
    return { ok: Boolean(sourceFiles) && JSON.stringify(bundled) === JSON.stringify(sourceFiles), observed: bundled.length };
  });

  checked('vault-fingerprint', () => {
    const firstLine = read(path.join(vaultRoot, 'STANDING.md')).split(/\r?\n/, 1)[0];
    return { ok: firstLine === FINGERPRINT_V2, observed: firstLine };
  });
  checked('vault-vendor-card', () => ({ ok: read(path.join(vaultRoot, 'VENDOR.md')).trim().length > 0 }));
  const rulesDir = path.join(vaultRoot, 'RULES');
  let names = [];
  checked('vault-R01-R22', () => {
    names = fs.readdirSync(rulesDir).filter((name) => /^R\d/.test(name));
    const validNames = names.every((name) => /^R\d{2}-[^/\\]+\.md$/.test(name) && read(path.join(rulesDir, name)).trim().length > 0);
    return { ok: validNames && same(names.map((name) => name.slice(0, 3)), RULE_IDS), observed: names };
  });
  checked('vault-rule-index', () => {
    const index = read(path.join(rulesDir, 'INDEX.md'));
    const links = [...index.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1].replace(/^\.\//, '')).filter((target) => /^R\d/.test(target));
    return { ok: names.length === RULE_IDS.length && same(links, names), observed: links };
  });
  checked('vault-seat-contract-language', () => {
    const result = checkBriefTemplate(read(path.join(vaultRoot, 'BRIEF-RULES-BLOCK.md')));
    return { ok: result.ok, observed: result.missing };
  });
  return { ok: findings.every((finding) => finding.ok), kitRoot, vaultRoot, runtimeRoot: runtime.root, findings };
}

function main(argv = process.argv.slice(2), io = process) {
  try {
    const options = {};
    const flags = { '--kit-root': 'kitRoot', '--vault-root': 'vaultRoot', '--runtime-root': 'runtimeRoot' };
    for (let i = 0; i < argv.length; i += 1) {
      const name = flags[argv[i]];
      if (!name) fail(`unknown option: ${argv[i]}`);
      const value = argv[++i];
      if (!value || value.startsWith('--')) fail(`missing value for ${argv[i - 1]}`);
      options[name] = value;
    }
    const result = check(options);
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  } catch (error) {
    io.stderr.write(`${error.code || 'CROSS_REPO_FAIL'}: ${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { check, main };
