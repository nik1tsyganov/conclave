// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
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

// The three CLIs live in ~/.local/bin; macOS also ships codex inside the ChatGPT desktop app.
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
    openai: env.CONCLAVE_CODEX_BIN,
    google: env.CONCLAVE_AGY_BIN,
    anthropic: env.CONCLAVE_CLAUDE_BIN,
  }[vendor];
  if (override) return [path.resolve(override)];
  const configPath = options.configFile || env.CONCLAVE_VENDOR_CONFIG;
  const config = options.config || (configPath ? readJsonFile(configPath) : {});
  const configured = config.vendors?.[vendor]?.binary;
  if (configured) return [path.resolve(configured)];

  result.push(...posixCandidates(vendor, home, platform));
  return [...new Set(result)];
}

function resolveVendorBinary(vendor, options = {}) {
  const list = candidates(vendor, options);
  const env = options.env || process.env;
  const explicit = options.binary || ({ openai: env.CONCLAVE_CODEX_BIN, google: env.CONCLAVE_AGY_BIN, anthropic: env.CONCLAVE_CLAUDE_BIN })[vendor];
  if (explicit && options.mustExist !== false && !existing(path.resolve(explicit))) {
    throw Object.assign(new Error(`Configured ${vendor} CLI does not exist: ${explicit}`), { code: 'BINARY_MISSING' });
  }
  const found = list.find(existing);
  if (found) return found;
  if (options.mustExist === false) return list[0] || null;
  const error = new Error(
    `No ${vendor} CLI binary found. Checked: ${list.join(', ')}. ` +
    `Set ${vendor === 'openai' ? 'CONCLAVE_CODEX_BIN' : vendor === 'google' ? 'CONCLAVE_AGY_BIN' : 'CONCLAVE_CLAUDE_BIN'} to override.`,
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

  resolveVendorBinary,
};
