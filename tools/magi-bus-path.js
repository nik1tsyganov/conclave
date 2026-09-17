'use strict';

/**
 * MAGI pointer-zone jail (repo or MAGI_BUS_ROOT).
 *
 * Briefs, receipts, and handoff outputs must sit under the kit repo or the
 * lead-written magi-bus temp root. Same two zones cli-claude.js already
 * enforces for --add-dir. Default MAGI_BUS_ROOT matches that module; tests
 * and Linux hosts override with the MAGI_BUS_ROOT env var.
 *
 * Does not replace cli-pointer.js / task-delivery.js. Those still deliver
 * the pointer; this only checks that a resolved path is inside the jail.
 */

const path = require('node:path');

const { canonicalPlainPath } = require('./runtime-paths.js');
// The legacy launchers (cli-claude.js, cli-gemini.js, cli-launch.js) were removed on
// 2026-09-16; the bus root default now lives here. MAGI_BUS_ROOT overrides it.
const DEFAULT_MAGI_BUS_ROOT = path.join(require('node:os').tmpdir(), 'magi-bus');
const HOST_MODES = Object.freeze(['cursor', 'cursor-cli', 'synara', 'claude-code']);

function getRepoRoot() {
  return path.resolve(__dirname, '..');
}

function getMagiBusRoot() {
  const fromEnv = process.env.MAGI_BUS_ROOT;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return fromEnv.trim();
  }
  return DEFAULT_MAGI_BUS_ROOT;
}

function looksWindowsPath(value) {
  return typeof value === 'string' && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\'));
}

function resolveAllowedPath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('path is required');
  }
  const trimmed = filePath.trim();
  if (looksWindowsPath(trimmed)) {
    return path.win32.resolve(trimmed);
  }
  return path.resolve(trimmed);
}

function compareKey(filePath) {
  const resolved = resolveAllowedPath(filePath);
  if (looksWindowsPath(resolved) || (resolved.includes('\\') && !resolved.startsWith('/'))) {
    return resolved.replace(/\//g, '\\').toLowerCase();
  }
  // Both the candidate and the zone roots (repo, os.tmpdir()-based bus root)
  // go through the canonicalizer so a symlinked ancestor compares as itself.
  return canonicalPlainPath(resolved);
}

function isUnderRoot(candidate, root) {
  const child = compareKey(candidate);
  const parent = compareKey(root);
  if (child === parent) return true;
  const sep = parent.includes('\\') ? '\\' : '/';
  const prefix = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(prefix);
}

function assertInJail(filePath, label = 'path') {
  const resolved = resolveAllowedPath(filePath);
  if (isUnderRoot(resolved, getRepoRoot()) || isUnderRoot(resolved, getMagiBusRoot())) {
    return resolved;
  }
  throw new Error(
    `${label} ${resolved} is outside the pointer zones (${getRepoRoot()}, ${getMagiBusRoot()})`
  );
}

function assertHostMode(hostMode) {
  if (!HOST_MODES.includes(hostMode)) {
    throw new Error(`hostMode must be cursor, cursor-cli, synara, or claude-code, got ${hostMode}`);
  }
  return hostMode;
}

module.exports = {
  DEFAULT_MAGI_BUS_ROOT,
  HOST_MODES,
  getRepoRoot,
  getMagiBusRoot,
  looksWindowsPath,
  resolveAllowedPath,
  isUnderRoot,
  assertInJail,
  assertHostMode,
};
