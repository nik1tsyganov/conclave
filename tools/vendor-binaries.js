'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJsonFile } = require('./json-file.js');

const VENDORS = Object.freeze(['openai', 'google', 'anthropic']);

function existing(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function newestCodexInstall(home = os.homedir()) {
  const root = path.join(home, 'AppData', 'Local', 'OpenAI', 'Codex', 'bin');
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, file: path.join(root, entry.name, 'codex.exe') }))
    .filter((entry) => existing(entry.file))
    .sort((a, b) => fs.statSync(b.file).mtimeMs - fs.statSync(a.file).mtimeMs || a.name.localeCompare(b.name));
  return candidates[0]?.file || null;
}

// POSIX hosts install the three CLIs into ~/.local/bin; macOS also ships codex
// inside the ChatGPT desktop app. These come before the Windows .exe defaults.
function posixCandidates(vendor, home, platform) {
  const name = { openai: 'codex', google: 'agy', anthropic: 'claude' }[vendor];
  const result = [path.join(home, '.local', 'bin', name)];
  const bundled = '/Applications/ChatGPT.app/Contents/Resources/codex';
  if (vendor === 'openai' && platform === 'darwin' && existing(bundled)) result.push(bundled);
  return result;
}

function candidates(vendor, options = {}) {
  if (!VENDORS.includes(vendor)) throw new Error(`unsupported vendor: ${vendor}`);
  const home = options.home || os.homedir();
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const result = [];
  if (options.binary) return [path.resolve(options.binary)];

  const override = {
    openai: env.MAGI_CODEX_BIN,
    google: env.MAGI_AGY_BIN,
    anthropic: env.MAGI_CLAUDE_BIN,
  }[vendor];
  if (override) return [path.resolve(override)];
  const configPath = options.configFile || env.MAGI_VENDOR_CONFIG;
  const config = options.config || (configPath ? readJsonFile(configPath) : {});
  const configured = config.vendors?.[vendor]?.binary;
  if (configured) return [path.resolve(configured)];

  if (platform !== 'win32') result.push(...posixCandidates(vendor, home, platform));

  if (vendor === 'openai') {
    result.push(path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'codex.exe'));
    const discovered = newestCodexInstall(home);
    if (discovered) result.push(discovered);
    result.push(path.join(home, 'tools', 'bin', 'codex.exe'));
  } else if (vendor === 'google') {
    result.push(path.join(home, 'AppData', 'Local', 'agy', 'bin', 'agy.exe'));
    result.push(path.join(home, 'tools', 'bin', 'agy.exe'));
  } else {
    result.push(path.join(home, '.local', 'bin', 'claude.exe'));
  }

  return [...new Set(result)];
}

function resolveVendorBinary(vendor, options = {}) {
  const list = candidates(vendor, options);
  const env = options.env || process.env;
  const explicit = options.binary || ({ openai: env.MAGI_CODEX_BIN, google: env.MAGI_AGY_BIN, anthropic: env.MAGI_CLAUDE_BIN })[vendor];
  if (explicit && options.mustExist !== false && !existing(path.resolve(explicit))) {
    throw Object.assign(new Error(`Configured ${vendor} CLI does not exist: ${explicit}`), { code: 'BINARY_MISSING' });
  }
  const found = list.find(existing);
  if (found) return found;
  if (options.mustExist === false) return list[0] || null;
  const error = new Error(
    `No ${vendor} CLI binary found. Checked: ${list.join(', ')}. ` +
    `Set ${vendor === 'openai' ? 'MAGI_CODEX_BIN' : vendor === 'google' ? 'MAGI_AGY_BIN' : 'MAGI_CLAUDE_BIN'} to override.`,
  );
  error.code = 'BINARY_MISSING';
  error.vendor = vendor;
  error.candidates = list;
  throw error;
}

module.exports = {
  VENDORS,
  candidates,
  existing,
  newestCodexInstall,
  resolveVendorBinary,
};
