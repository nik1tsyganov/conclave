// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

/**
 * CONCLAVE pointer-zone jail (repo or CONCLAVE_BUS_ROOT).
 *
 * Briefs, receipts, and handoff outputs must sit under the kit repo or the
 * lead-written conclave-bus temp root. Same two zones cli-claude.js already
 * enforces for --add-dir. Default CONCLAVE_BUS_ROOT matches that module; tests
 * and Linux hosts override with the CONCLAVE_BUS_ROOT env var.
 *
 * Does not replace cli-pointer.js / task-delivery.js. Those still deliver
 * the pointer; this only checks that a resolved path is inside the jail.
 */

const path = require('node:path');

const { canonicalPlainPath } = require('./runtime-paths.js');
// One host-mode list, and it is dispatch-schema.js's. This module kept a second copy until
// 2026-09-18; that copy stopped at claude-code, so assertHostMode rejected vscode and droppy
// for as long as both had been hosts. A second list is not a feature.
const { HOST_MODES } = require('./dispatch-schema.js');
// The legacy launchers (cli-claude.js, cli-gemini.js, cli-launch.js) were removed on
// 2026-09-16; the bus root default now lives here. CONCLAVE_BUS_ROOT overrides it.
const DEFAULT_CONCLAVE_BUS_ROOT = path.join(require('node:os').tmpdir(), 'conclave-bus');

function getRepoRoot() {
  return path.resolve(__dirname, '..');
}

function getConclaveBusRoot() {
  const fromEnv = process.env.CONCLAVE_BUS_ROOT;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return fromEnv.trim();
  }
  return DEFAULT_CONCLAVE_BUS_ROOT;
}

function resolveAllowedPath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('path is required');
  }
  return path.resolve(filePath.trim());
}

function compareKey(filePath) {
  const resolved = resolveAllowedPath(filePath);
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
  if (isUnderRoot(resolved, getRepoRoot()) || isUnderRoot(resolved, getConclaveBusRoot())) {
    return resolved;
  }
  throw new Error(
    `${label} ${resolved} is outside the pointer zones (${getRepoRoot()}, ${getConclaveBusRoot()})`
  );
}

function assertHostMode(hostMode) {
  if (!HOST_MODES.includes(hostMode)) {
    throw new Error(`hostMode must be one of ${HOST_MODES.join(', ')}, got ${hostMode}`);
  }
  return hostMode;
}

module.exports = {
  DEFAULT_CONCLAVE_BUS_ROOT,
  HOST_MODES,
  getRepoRoot,
  getConclaveBusRoot,
  resolveAllowedPath,
  isUnderRoot,
  assertInJail,
  assertHostMode,
};
