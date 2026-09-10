'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalPlainPath } = require('./runtime-paths.js');

const VAULT_MARKERS = Object.freeze(['Wiki/Index.md', 'HOW-TO-ADD-DATA.md']);
const SECRET_RE = /(?:BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|sk-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|api[_-]?key\s*[:=])/i;

function vaultError(message, code = 'VAULT_FAIL') {
  return Object.assign(new Error(message), { code });
}

function envOf(options = {}) {
  return options.env !== undefined ? options.env : process.env;
}

function looksSecret(text) {
  return SECRET_RE.test(String(text || ''));
}

function assertVaultRoot(root) {
  if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory()) {
    throw vaultError('MAGI_VAULT_ROOT is not a directory; set it to the ai-ops-vault checkout');
  }
  for (const relative of VAULT_MARKERS) {
    const file = path.join(root, ...relative.split('/'));
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
      throw vaultError(`MAGI_VAULT_ROOT is not an ai-ops-vault: missing ${relative}`);
    }
    const text = fs.readFileSync(file, 'utf8');
    if (looksSecret(text)) throw vaultError(`credential-looking content in vault marker ${relative}`);
  }
}

function resolveVaultRoot(options = {}) {
  const raw = options.vaultRoot || envOf(options).MAGI_VAULT_ROOT;
  if (!raw) return null;
  const root = path.resolve(raw);
  assertVaultRoot(root);
  return canonicalPlainPath(root);
}

function requireVaultRoot(options = {}) {
  const root = resolveVaultRoot(options);
  if (!root) throw vaultError('set MAGI_VAULT_ROOT to the ai-ops-vault checkout');
  return root;
}

function vaultLayout(root) {
  const home = path.join(root, 'projects', 'magi');
  return {
    root,
    home,
    telemetryLog: path.join(home, 'telemetry', 'dispatches.jsonl'),
    analysisDir: path.join(home, 'analysis'),
    analysisLatestJson: path.join(home, 'analysis', 'latest.json'),
    analysisLatestMd: path.join(home, 'analysis', 'latest.md'),
    seatSkills: path.join(home, 'seat-skills'),
    seatProfiles: path.join(home, 'seat-profiles.json'),
    inbox: path.join(home, 'seat-skills-inbox'),
    runsDir: path.join(home, 'runs'),
    skillWebJson: path.join(home, 'skill-web.json'),
    skillWebMd: path.join(home, 'skill-web.md'),
  };
}

function ensureVaultHome(root) {
  const layout = vaultLayout(root);
  for (const dir of [layout.home, path.dirname(layout.telemetryLog), layout.analysisDir, layout.seatSkills, layout.inbox, layout.runsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return layout;
}

module.exports = {
  SECRET_RE,
  VAULT_MARKERS,
  assertVaultRoot,
  ensureVaultHome,
  envOf,
  looksSecret,
  requireVaultRoot,
  resolveVaultRoot,
  vaultError,
  vaultLayout,
};
