#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const { resolveVendorBinary } = require('./vendor-binaries.js');
const { FINGERPRINT_V2, listRuleFiles } = require('./cli-rules-stage.js');
const { FORBIDDEN_ARBITER_SKILLS, regularFiles } = require('./cli-skill-stage.js');
const { CLI_RUNTIME_TOOLS, canonicalPlainPath, resolveRulesRoot, resolveRuntimePaths } = require('./runtime-paths.js');
const { resolveVaultRoot } = require('./conclave-vault.js');
const { loadProfiles } = require('./seat-policy.js');

function unique(values) { return [...new Set(values)]; }

function synaraCaptureHookPaths(home) {
  return [
    path.join(home, '.gemini', 'antigravity-cli', 'plugins', 'synara-capture', 'hooks.json'),
    path.join(home, '.gemini', 'config', 'plugins', 'synara-capture', 'hooks.json'),
  ];
}

function inspectSynaraCaptureHooks(home) {
  const files = synaraCaptureHookPaths(home).filter((file) => fs.existsSync(file));
  for (const file of files) {
    if (!fs.lstatSync(file).isFile()) throw new Error(`synara-capture hooks path is not a regular file: ${file}`);
    const text = fs.readFileSync(file, 'utf8');
    if (/"decision"\s*:\s*"ask"/.test(text) || /\\"decision\\":\\"ask\\"/.test(text)) {
      throw new Error(`inactive synara-capture PreToolUse emits ask (${file}); CONCLAVE Google instruction reads will fail`);
    }
  }
  return { value: files.length ? files : 'absent' };
}

function requiredSeatSkills(profiles) {
  return unique([
    ...Object.values(profiles.baseSkills || {}).flat(),
    ...Object.values(profiles.roleSkills || {}).flat(),
    ...Object.values(profiles.classSkills || {}).flat(),
  ]);
}


function check(options = {}) {
  const home = options.home || os.homedir();
  const findings = [];
  const record = (name, action) => {
    try { findings.push({ check: name, ok: true, ...action() }); }
    catch (error) { findings.push({ check: name, ok: false, error: error.message }); }
  };
  let paths;
  let profiles;
  record('runtime:contracts', () => {
    paths = resolveRuntimePaths({ root: options.runtimeRoot });
    profiles = loadProfiles(options.seatProfiles || paths.seatProfilesPath);
    return { value: paths.root };
  });
  if (paths) record('runtime:files', () => {
    for (const name of CLI_RUNTIME_TOOLS) {
      const file = canonicalPlainPath(path.join(paths.toolsDir, name));
      if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) throw new Error(`required runtime file missing: ${file}`);
      fs.accessSync(file, fs.constants.R_OK);
    }
    return { count: CLI_RUNTIME_TOOLS.length };
  });

  for (const vendor of ['openai', 'google', 'anthropic']) {
    record(`binary:${vendor}`, () => ({ value: resolveVendorBinary(vendor, { home, env: options.env }) }));
  }

  const arbiterSkills = unique(profiles?.arbiterSkills || []);
  const seatSkills = profiles ? requiredSeatSkills(profiles) : [];
  findings.push({ check: 'skills:allow-list', ok: seatSkills.length > 0 });
  for (const skill of seatSkills) {
    record(`seat-skill:${skill}`, () => {
      if (typeof skill !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(skill)) throw new Error('invalid seat skill name');
      const root = path.join(paths.seatSkillsRoot, skill);
      const file = path.join(root, 'SKILL.md');
      if (!regularFiles(root).includes(file)) throw new Error(`bundled seat skill missing regular SKILL.md: ${file}`);
      if (!fs.readFileSync(file, 'utf8').trim()) throw new Error(`required SKILL.md is empty: ${file}`);
      return { value: file };
    });
  }

  const forbidden = unique([...FORBIDDEN_ARBITER_SKILLS, ...(profiles?.forbiddenSeatSkills || [])]);
  const overlap = seatSkills.filter((skill) => forbidden.includes(skill));
  findings.push({ check: 'skills:arbiter-seat-separation', ok: overlap.length === 0, observed: overlap });

  let rulesRoot;
  record('rules:root', () => {
    rulesRoot = canonicalPlainPath(resolveRulesRoot({ rulesRoot: options.rulesRoot, env: options.env }));
    const files = regularFiles(rulesRoot);
    for (const relative of ['STANDING.md', 'VENDOR.md', 'RULES/INDEX.md']) {
      const file = path.join(rulesRoot, ...relative.split('/'));
      if (!files.includes(file)) throw new Error(`external rules pack missing ${relative}; set CONCLAVE_RULES_ROOT or pass rulesRoot`);
      if (!fs.readFileSync(file, 'utf8').trim()) throw new Error(`required rule content is empty: ${relative}`);
    }
    return { value: rulesRoot };
  });
  if (rulesRoot) {
    record('rules:fingerprint', () => {
      const standing = path.join(rulesRoot, 'STANDING.md');
      const fingerprint = fs.readFileSync(standing, 'utf8').split(/\r?\n/, 1)[0];
      if (fingerprint !== FINGERPRINT_V2) throw new Error('STANDING.md must have the trusted CONCLAVE-CLI-STANDING v2 first line');
      return { value: standing, observed: fingerprint };
    });
    record('rules:R01-R22', () => {
      const rulesDir = path.join(rulesRoot, 'RULES');
      const names = listRuleFiles(rulesDir);
      if (!names.some(name => name.startsWith('R22-'))) throw new Error('rules pack missing R22');
      if (names.length !== 22) throw new Error('production rules pack must contain exactly R01-R22');
      for (const name of names) {
        if (!fs.lstatSync(path.join(rulesDir, name)).isFile()) throw new Error(`rule must be a regular file: ${name}`);
        if (!fs.readFileSync(path.join(rulesDir, name), 'utf8').trim()) throw new Error(`required rule content is empty: ${name}`);
      }
      return { value: rulesDir, observed: names.map(name => name.slice(0, 3)) };
    });
  }

  record('google:synara-capture', () => inspectSynaraCaptureHooks(home));
  record('vault:root', () => {
    const raw = (options.env !== undefined ? options.env : process.env).CONCLAVE_VAULT_ROOT;
    if (!raw) return { value: null, note: 'set CONCLAVE_VAULT_ROOT to ai-ops-vault for CONCLAVE telemetry, skill sync, and analysis' };
    return { value: resolveVaultRoot({ vaultRoot: raw, env: options.env !== undefined ? options.env : process.env }) };
  });
  const env = options.env !== undefined ? options.env : process.env;
  record('skill-web:field-library', () => {
    const raw = env.CONCLAVE_FIELD_LIBRARY_ROOT;
    if (!raw) return { value: null, note: 'set CONCLAVE_FIELD_LIBRARY_ROOT to index host field modules' };
    const index = path.join(raw, 'INDEX.md');
    if (!fs.existsSync(index) || !fs.existsSync(path.join(raw, 'modules'))) throw new Error('CONCLAVE_FIELD_LIBRARY_ROOT is not a field-library checkout');
    return { value: path.resolve(raw) };
  });
  record('skill-web:vault-skills', () => {
    const raw = env.CONCLAVE_VAULT_SKILLS_ROOT;
    if (!raw) return { value: null, note: 'set CONCLAVE_VAULT_SKILLS_ROOT to index Obsidian ingest methods' };
    if (!fs.existsSync(path.join(raw, 'skills', 'vault-ingest', 'SKILL.md'))) throw new Error('CONCLAVE_VAULT_SKILLS_ROOT is not a vault-skills checkout');
    return { value: path.resolve(raw) };
  });

  return { ok: findings.every((f) => f.ok), arbiterSkills, seatSkills, findings };
}

function main(argv = process.argv.slice(2), io = process) {
  let result;
  try {
    const options = {};
    const flags = { '--rules-root': 'rulesRoot', '--seat-profiles': 'seatProfiles' };
    for (let i = 0; i < argv.length; i += 1) {
      const key = flags[argv[i]];
      if (!key || options[key] || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`unknown, duplicate or incomplete preflight option: ${argv[i]}`);
      options[key] = argv[++i];
    }
    result = check(options);
  } catch (error) {
    result = { ok: false, findings: [{ check: 'preflight', ok: false, error: error.message }] };
  }
  io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 2;
}

if (require.main === module) process.exitCode = main();
module.exports = { check, inspectSynaraCaptureHooks, main, requiredSeatSkills, synaraCaptureHookPaths };
