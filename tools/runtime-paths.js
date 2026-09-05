#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');

function runtimeError(message) {
  const error = new Error(message);
  error.code = 'RUNTIME_PATHS_FAIL';
  return error;
}

// Resolve existing ancestors without accepting junctions, symlinks or file parents.
// This also canonicalizes Windows short-name and case aliases before containment checks.
function canonicalPlainPath(file) {
  if (typeof file !== 'string' || !file.trim()) throw runtimeError('a non-empty filesystem path is required');
  const absolute = path.resolve(file);
  const parsed = path.parse(absolute);
  const segments = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  if (process.platform === 'win32' && (
    /^\\\\[?.]\\/.test(absolute) ||
    segments.some(segment => /[. ]$|[<>:"|?*\x00-\x1f]/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))
  )) throw runtimeError(`ambiguous or unsafe Windows path: ${absolute}`);
  let current = parsed.root;
  for (let i = 0; i <= segments.length; i += 1) {
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return path.join(fs.realpathSync.native(path.dirname(current)), path.basename(current), ...segments.slice(i));
    }
    if (stat.isSymbolicLink()) throw runtimeError(`symlink or junction forbidden in path: ${current}`);
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

module.exports = { DEFAULT_ROOT, canonicalPlainPath, pathsOverlap, resolveRuntimePaths, resolveRulesRoot };
