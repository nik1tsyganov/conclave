#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const { createHash } = require('node:crypto');
const { googleCaptureEnv } = require('./cli-adapters.js');
const { resolveVendorBinary } = require('./vendor-binaries.js');
const { FINGERPRINT_V2, listRuleFiles } = require('./cli-rules-stage.js');
const { FORBIDDEN_ARBITER_SKILLS, regularFiles } = require('./cli-skill-stage.js');
const { CLI_RUNTIME_TOOLS, canonicalPlainPath, resolveRulesRoot, resolveRuntimePaths } = require('./runtime-paths.js');
const { resolveVaultRoot } = require('./magi-vault.js');
const { loadProfiles } = require('./seat-policy.js');

function unique(values) { return [...new Set(values)]; }

function synaraCaptureHookPaths(home) {
  return [
    path.join(home, '.gemini', 'antigravity-cli', 'plugins', 'synara-capture', 'hooks.json'),
    path.join(home, '.gemini', 'config', 'plugins', 'synara-capture', 'hooks.json'),
  ];
}

// Reviewed installed helper. Any upstream change needs another static review.
const SYNARA_CAPTURE_HELPER_SHA256 = '5f9bad9a6f28f7575e55bc93e78ecf25cbe70e52fe4f4598eeb9aff36071e480';

function inspectSynaraCaptureHooks(home, options = {}) {
  const files = options.files || synaraCaptureHookPaths(home).filter((file) => fs.existsSync(file));
  const events = { PreToolUse: 'pre-tool', PostToolUse: 'post-tool', PreInvocation: 'pre-invocation', PostInvocation: 'post-invocation', Stop: 'stop' };
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  let isolated = false;
  for (const file of files) {
    canonicalPlainPath(file);
    if (!fs.lstatSync(file).isFile()) throw new Error(`synara-capture hooks path is not a regular file: ${file}`);
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { throw new Error(`malformed synara-capture hooks JSON: ${file}`); }
    const hooks = parsed?.['synara-capture'];
    if (!object(parsed) || Object.keys(parsed).join() !== 'synara-capture' || !object(hooks) || !Object.keys(hooks).length) throw new Error(`unsupported synara-capture hook shape: ${file}`);
    for (const [event, entries] of Object.entries(hooks)) {
      if (!Object.hasOwn(events, event) || !Array.isArray(entries) || !entries.length) throw new Error(`unsupported synara-capture hook event: ${file}`);
      for (const entry of entries) {
        if (!object(entry)) throw new Error(`malformed synara-capture hook entry: ${file}`);
        const grouped = Object.hasOwn(entry, 'hooks');
        if (grouped && (Object.keys(entry).some(key => !['matcher', 'hooks'].includes(key)) || (entry.matcher !== undefined && typeof entry.matcher !== 'string') || !Array.isArray(entry.hooks) || !entry.hooks.length)) throw new Error(`malformed synara-capture hook group: ${file}`);
        for (const hook of grouped ? entry.hooks : [entry]) {
          if (!object(hook) || Object.keys(hook).some(key => !['type', 'command'].includes(key)) || (hook.type !== undefined && hook.type !== 'command') || typeof hook.command !== 'string') throw new Error(`malformed synara-capture command: ${file}`);
          const fallback = event === 'PreToolUse' ? '{"decision":"ask"}' : '{}';
          const safeEcho = event === 'PreToolUse' ? 'echo {"decision":"allow"}' : 'echo {}';
          if (hook.command === safeEcho) continue;
          if (hook.command === 'echo {"decision":"ask"}') throw new Error(`synara-capture ${event} emits ask: ${file}`);
          const binary = path.join(home, 'AppData', 'Local', 'Programs', 'synara-desktop', 'Synara.exe');
          const helper = path.join(home, '.gemini', 'antigravity-cli', 'plugins', 'synara-capture', 'capture.cjs');
          const expected = `if not defined SYNARA_ANTIGRAVITY_EVENTS (more >nul 2>nul & echo ${fallback}) else (set ELECTRON_RUN_AS_NODE=1&& ${binary} ${helper} ${events[event]})`;
          if ((options.platform || process.platform) !== 'win32' || hook.command !== expected || /[\s&|<>^%!?"()]/.test(binary + helper)) throw new Error(`unsupported synara-capture active command: ${file}`);
          for (const target of [binary, helper]) {
            canonicalPlainPath(target);
            if (!fs.lstatSync(target).isFile()) throw new Error(`synara-capture target is not a regular file: ${target}`);
          }
          const digest = createHash('sha256').update(fs.readFileSync(helper)).digest('hex');
          if (digest !== SYNARA_CAPTURE_HELPER_SHA256) throw new Error(`unreviewed synara-capture helper: ${helper}`);
          const capture = googleCaptureEnv(options.env || {}, path.join(home, '.magi-preflight-capture'));
          if (!capture.eventsPath || capture.env.SYNARA_ANTIGRAVITY_EVENTS !== capture.eventsPath || capture.env.SYNARA_ANTIGRAVITY_HOOK_DECISION !== 'allow') throw new Error('Google adapter does not guarantee the reviewed capture allow branch');
          isolated = true;
        }
      }
    }
  }
  return { value: files.length ? files : 'absent', ...(isolated ? {
    status: 'adapter-isolated',
    helperSha256: SYNARA_CAPTURE_HELPER_SHA256,
    inactiveParentBranch: 'ask; bypassed by the Google dispatch/probe child environment',
    scope: 'Known Windows conditional hook and adapter environment only; hook events are diagnostics, not native proof; runtime execution and event-file access remain untested',
  } : {}) };
}

function requiredSeatSkills(profiles) {
  return unique([
    ...Object.values(profiles.baseSkills || {}).flat(),
    ...Object.values(profiles.roleSkills || {}).flat(),
    ...Object.values(profiles.classSkills || {}).flat(),
  ]);
}

// File-only syntax check. This is not a native schema or sandbox-shell probe.
function checkWindowsSandboxState(home, env, platform) {
  const scope = 'Native state syntax only; sandbox shell and staged-file access remain untested';
  if (platform !== 'win32') return { status: 'not-applicable', scope };
  let codexHome = path.join(home, '.codex');
  if (env.CODEX_HOME) {
    // Native Codex resolves relative overrides at its cwd; MAGI dispatch cwd can differ.
    const root = path.parse(env.CODEX_HOME).root;
    if (!path.isAbsolute(env.CODEX_HOME) || (path.sep === '\\' && root.length === 1)) {
      throw new Error('MAGI preflight requires an absolute, fully qualified CODEX_HOME; dispatch working directories can differ');
    }
    try {
      if (!fs.statSync(env.CODEX_HOME).isDirectory()) throw new Error('must be an existing directory');
      codexHome = fs.realpathSync.native(env.CODEX_HOME);
    } catch (error) { throw new Error(`Invalid CODEX_HOME ${env.CODEX_HOME}: ${error.code || error.message}`); }
  }
  const file = path.join(codexHome, '.sandbox', 'deny_read_acl_state.json');
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) {
    if (error.code === 'ENOENT') return { value: file, status: 'uninitialized', scope };
    throw new Error(`Cannot inspect native sandbox state ${file}: ${error.code || 'read error'}`);
  }
  if (!stat.isFile()) throw new Error(`Native sandbox state must be a regular file: ${file}`);
  const limit = 1024 * 1024;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('must be a regular file');
    if (stat.size > limit) throw new Error('exceeds the 1 MiB preflight read limit');
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > limit) throw new Error('exceeds the 1 MiB preflight read limit');
    try {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
      JSON.parse(text);
    } catch { throw new Error('must contain strict UTF-8 JSON (no BOM, NUL, empty or malformed input)'); }
  } catch (error) {
    throw new Error(`Invalid or unreadable native sandbox state ${file}: ${error.code || error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return { value: file, status: 'syntax-valid', scope };
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

  record('sandbox:openai-state', () => checkWindowsSandboxState(home, options.env || process.env, options.platform || process.platform));

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
      if (!files.includes(file)) throw new Error(`external rules pack missing ${relative}; set MAGI_RULES_ROOT or pass rulesRoot`);
      if (!fs.readFileSync(file, 'utf8').trim()) throw new Error(`required rule content is empty: ${relative}`);
    }
    return { value: rulesRoot };
  });
  if (rulesRoot) {
    record('rules:fingerprint', () => {
      const standing = path.join(rulesRoot, 'STANDING.md');
      const fingerprint = fs.readFileSync(standing, 'utf8').split(/\r?\n/, 1)[0];
      if (fingerprint !== FINGERPRINT_V2) throw new Error('STANDING.md must have the trusted MAGI-CLI-STANDING v2 first line');
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

  record('google:synara-capture', () => inspectSynaraCaptureHooks(home, options));
  record('vault:root', () => {
    const raw = (options.env !== undefined ? options.env : process.env).MAGI_VAULT_ROOT;
    if (!raw) return { value: null, note: 'set MAGI_VAULT_ROOT to ai-ops-vault for MAGI telemetry, skill sync, and analysis' };
    return { value: resolveVaultRoot({ vaultRoot: raw, env: options.env !== undefined ? options.env : process.env }) };
  });
  const env = options.env !== undefined ? options.env : process.env;
  record('skill-web:field-library', () => {
    const raw = env.MAGI_FIELD_LIBRARY_ROOT;
    if (!raw) return { value: null, note: 'set MAGI_FIELD_LIBRARY_ROOT to index host field modules' };
    const index = path.join(raw, 'INDEX.md');
    if (!fs.existsSync(index) || !fs.existsSync(path.join(raw, 'modules'))) throw new Error('MAGI_FIELD_LIBRARY_ROOT is not a field-library checkout');
    return { value: path.resolve(raw) };
  });
  record('skill-web:vault-skills', () => {
    const raw = env.MAGI_VAULT_SKILLS_ROOT;
    if (!raw) return { value: null, note: 'set MAGI_VAULT_SKILLS_ROOT to index Obsidian ingest methods' };
    if (!fs.existsSync(path.join(raw, 'skills', 'vault-ingest', 'SKILL.md'))) throw new Error('MAGI_VAULT_SKILLS_ROOT is not a vault-skills checkout');
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
