#!/usr/bin/env node
// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with section 7 terms; see LICENSE.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');

const CLI_RUNTIME_TOOLS = Object.freeze([
  'activation-check.js', 'hog-check.js', 'host-resolver.js', 'position-tally.js',
  'cli-adapters.js', 'cli-brief-rules-check.js', 'cli-idle.js', 'cli-pointer.js',
  'cli-process.js', 'cli-proof.js', 'cli-rules-stage.js', 'cli-runner.js', 'cli-skill-stage.js',
  'dispatch-evidence.js', 'dispatch-matrix.js', 'dispatch-run.js', 'dispatch-schema.js', 'magi-cli-preflight.js', 'magi-whoami.js',
  'model-availability.js', 'model-probe.js', 'plan-seal.js', 'probe-evidence.js', 'vendor-native.js',
  'run-finalize.js', 'panel-tally.js', 'project-run-report.js', 'plugin-surface.js',
  'runtime-paths.js', 'seat-policy.js', 'telemetry-append.js', 'vendor-binaries.js', 'json-file.js',
  'synara-catalog.js', 'magi-synara-watch.js', 'host-helper-evidence.js', 'host-helper-worktree.js',
  'instruction-read-evidence.js', 'evidence-read-access.js',
  'magi-vault.js', 'magi-vault-link.js', 'magi-vault-sync.js', 'magi-vault-analyze.js', 'magi-skill-web.js',
  'dispatch-log.pass.jsonl', 'dispatch-log.fail.jsonl',
  // Added 2026-09-16 (macOS): Jev arbiter, run driver, dashboard, retry, telemetry rows.
  'jev-client.js', 'jev-arbiter.js', 'jev-check.js', 'jev-plan-classify.js', 'panel-tally-jev.js', 'run-drive.js', 'launch-retry.js', 'ledger-row.js', 'magi-dashboard.js', 'dashboard.html', 'dashboard.css', 'dashboard.js',
]);

function runtimeError(message) {
  const error = new Error(message);
  error.code = 'RUNTIME_PATHS_FAIL';
  return error;
}

// Resolve existing ancestors, then require the RESOLVED path to be plain: no
// junction, symlink or file parent inside it.
// macOS ships /tmp and /var as root-level aliases for /private/..., so every
// os.tmpdir() path has a linked ancestor. A POSIX symlink that is a direct child
// of the filesystem root is therefore platform layout: it is resolved first and
// the plain-path rule is re-asserted on the realpath (which is also what the
// callers' containment checks then see). Any deeper link is run-controlled and
// stays refused. The realpath also canonicalizes case aliases before containment checks.
function canonicalPlainPath(file) {
  if (typeof file !== 'string' || !file.trim()) throw runtimeError('a non-empty filesystem path is required');
  const absolute = path.resolve(file);
  const parsed = path.parse(absolute);
  const segments = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (let i = 0; i <= segments.length; i += 1) {
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return path.join(fs.realpathSync.native(path.dirname(current)), path.basename(current), ...segments.slice(i));
    }
    if (stat.isSymbolicLink()) {
      if (i !== 1) throw runtimeError(`symlink forbidden in path: ${current}`);
      return canonicalPlainPath(path.join(fs.realpathSync.native(current), ...segments.slice(i)));
    }
    if (i < segments.length && !stat.isDirectory()) throw runtimeError(`filesystem parent is not a directory: ${current}`);
    if (i < segments.length) current = path.join(current, segments[i]);
  }
  return fs.realpathSync.native(absolute);
}

function pathsOverlap(first, second) {
  const inside = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  return inside(first, second) || inside(second, first);
}

function hasReferenceFiles(referencesDir) {
  return ['dispatch-matrix.json', 'seat-profiles.json'].every(name => {
    const file = path.join(referencesDir, name);
    return fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink();
  });
}

// Source checkouts keep contracts under .cursor/skills/magi-cli/references;
// installer output flattens that to skills/magi-cli/references (see install-plugin.js).
function detectLayout(root) {
  const sourceReferences = path.join(root, '.cursor', 'skills', 'magi-cli', 'references');
  const installedReferences = path.join(root, 'skills', 'magi-cli', 'references');
  const sourceOk = hasReferenceFiles(sourceReferences);
  const installedOk = hasReferenceFiles(installedReferences);
  if (sourceOk && installedOk) {
    throw runtimeError(
      `ambiguous MAGI CLI runtime layout under ${root}: both ${sourceReferences} and ${installedReferences} contain reference contracts`,
    );
  }
  if (sourceOk) return { layout: 'source', referencesDir: canonicalPlainPath(sourceReferences) };
  if (installedOk) return { layout: 'installed', referencesDir: canonicalPlainPath(installedReferences) };
  throw runtimeError(
    `cannot locate MAGI CLI reference contracts under ${root}; checked ${sourceReferences} and ${installedReferences}`,
  );
}

function resolveRuntimePaths(options = {}) {
  const root = canonicalPlainPath(options.root || DEFAULT_ROOT);
  if (!fs.existsSync(root)) throw runtimeError(`MAGI CLI runtime root does not exist: ${root}`);
  const toolsDir = path.join(root, 'tools');
  if (!fs.existsSync(toolsDir) || !fs.lstatSync(toolsDir).isDirectory()) throw runtimeError(`MAGI CLI runtime tools directory missing: ${toolsDir}`);
  canonicalPlainPath(toolsDir);
  const { layout, referencesDir } = detectLayout(root);
  return {
    root,
    layout,
    matrixPath: path.join(referencesDir, 'dispatch-matrix.json'),
    seatProfilesPath: path.join(referencesDir, 'seat-profiles.json'),
    seatSkillsRoot: path.join(root, 'seat-skills'),
    templatesDir: path.join(toolsDir, 'templates'),
    toolsDir,
    referencesDir,
  };
}

// Standing rules are never bundled; MAGI_RULES_ROOT (or an explicit rulesRoot)
// must point at an external pack. This never falls back to a different source.
function resolveRulesRoot(options = {}) {
  const rulesRoot = options.rulesRoot || (options.env || process.env).MAGI_RULES_ROOT || options.defaultRulesRoot;
  if (!rulesRoot) {
    throw runtimeError('no rules root supplied: set MAGI_RULES_ROOT or pass an explicit rulesRoot/defaultRulesRoot');
  }
  return path.resolve(rulesRoot);
}

module.exports = { CLI_RUNTIME_TOOLS, DEFAULT_ROOT, canonicalPlainPath, pathsOverlap, resolveRuntimePaths, resolveRulesRoot };
