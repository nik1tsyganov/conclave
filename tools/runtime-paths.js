#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');

const CLI_RUNTIME_TOOLS = Object.freeze([
  'activation-check.js', 'hog-check.js', 'host-resolver.js', 'position-tally.js',
  'cli-adapters.js', 'cli-brief-rules-check.js', 'cli-idle.js', 'cli-pointer.js',
  'cli-process.js', 'cli-proof.js', 'cli-rules-stage.js', 'cli-runner.js', 'cli-skill-stage.js',
  'dispatch-evidence.js', 'dispatch-matrix.js', 'dispatch-run.js', 'dispatch-schema.js', 'conclave-cli-preflight.js', 'conclave-whoami.js',
  'model-availability.js', 'model-probe.js', 'plan-seal.js', 'probe-evidence.js', 'vendor-native.js',
  'run-finalize.js', 'panel-tally.js', 'project-run-report.js', 'plugin-surface.js',
  'runtime-paths.js', 'seat-policy.js', 'telemetry-append.js', 'vendor-binaries.js', 'json-file.js',
  'synara-catalog.js', 'conclave-synara-watch.js', 'host-helper-evidence.js', 'host-helper-worktree.js',
  'instruction-read-evidence.js', 'evidence-read-access.js', 'arbiter-policy.js', 'panel-stats.js', 'lane-pick.js',
  'conclave-vault.js', 'conclave-vault-link.js', 'conclave-vault-sync.js', 'conclave-vault-analyze.js', 'conclave-skill-web.js',
  'dispatch-log.pass.jsonl', 'dispatch-log.fail.jsonl',
  // Added 2026-09-16 (macOS): Jev arbiter, run driver, dashboard, retry, telemetry rows.
  'jev-client.js', 'jev-arbiter.js', 'jev-check.js', 'jev-plan-classify.js', 'panel-tally-jev.js', 'run-drive.js', 'launch-retry.js', 'ledger-row.js', 'conclave-dashboard.js', 'dashboard.html', 'dashboard.css', 'dashboard.js',
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

// Source checkouts keep contracts under .cursor/skills/conclave-cli/references;
// installer output flattens that to skills/conclave-cli/references (see install-plugin.js).
function detectLayout(root) {
  const sourceReferences = path.join(root, '.cursor', 'skills', 'conclave-cli', 'references');
  const installedReferences = path.join(root, 'skills', 'conclave-cli', 'references');
  const sourceOk = hasReferenceFiles(sourceReferences);
  const installedOk = hasReferenceFiles(installedReferences);
  if (sourceOk && installedOk) {
    throw runtimeError(
      `ambiguous CONCLAVE CLI runtime layout under ${root}: both ${sourceReferences} and ${installedReferences} contain reference contracts`,
    );
  }
  if (sourceOk) return { layout: 'source', referencesDir: canonicalPlainPath(sourceReferences) };
  if (installedOk) return { layout: 'installed', referencesDir: canonicalPlainPath(installedReferences) };
  throw runtimeError(
    `cannot locate CONCLAVE CLI reference contracts under ${root}; checked ${sourceReferences} and ${installedReferences}`,
  );
}

function resolveRuntimePaths(options = {}) {
  const root = canonicalPlainPath(options.root || DEFAULT_ROOT);
  if (!fs.existsSync(root)) throw runtimeError(`CONCLAVE CLI runtime root does not exist: ${root}`);
  const toolsDir = path.join(root, 'tools');
  if (!fs.existsSync(toolsDir) || !fs.lstatSync(toolsDir).isDirectory()) throw runtimeError(`CONCLAVE CLI runtime tools directory missing: ${toolsDir}`);
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

// Resolution order: an explicit rulesRoot, then CONCLAVE_RULES_ROOT, then the
// caller's default. This primitive still refuses to guess: with none of the three
// it throws. A caller that ships a pack passes it as defaultRulesRoot.
// A CONCLAVE_RULES_ROOT that is present but empty is an operator who meant to name
// a pack, so it is an error rather than a silent fall-through to the default.
function resolveRulesRoot(options = {}) {
  const env = options.env || process.env;
  if (!options.rulesRoot && 'CONCLAVE_RULES_ROOT' in env && !String(env.CONCLAVE_RULES_ROOT).trim()) {
    throw runtimeError('CONCLAVE_RULES_ROOT is set but empty: name a rules pack or unset it');
  }
  const rulesRoot = options.rulesRoot || env.CONCLAVE_RULES_ROOT || options.defaultRulesRoot;
  if (!rulesRoot) {
    throw runtimeError('no rules root supplied: set CONCLAVE_RULES_ROOT or pass an explicit rulesRoot/defaultRulesRoot');
  }
  return path.resolve(rulesRoot);
}

module.exports = { CLI_RUNTIME_TOOLS, DEFAULT_ROOT, canonicalPlainPath, pathsOverlap, resolveRuntimePaths, resolveRulesRoot };
