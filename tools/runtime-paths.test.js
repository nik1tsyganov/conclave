// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_ROOT, canonicalPlainPath, pathsOverlap, resolveRuntimePaths, resolveRulesRoot } = require('./runtime-paths.js');

const temporary = [];
function temp() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-runtime-paths-')); temporary.push(root); return root; }
test.after(() => {
  for (const root of temporary) {
    assert.strictEqual(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function writeReferences(referencesDir) {
  fs.mkdirSync(referencesDir, { recursive: true });
  fs.writeFileSync(path.join(referencesDir, 'dispatch-matrix.json'), '{}\n', 'utf8');
  fs.writeFileSync(path.join(referencesDir, 'seat-profiles.json'), '{}\n', 'utf8');
}

test('default root resolves the real source checkout', () => {
  const resolved = resolveRuntimePaths();
  const canonicalRoot = fs.realpathSync.native(DEFAULT_ROOT);
  assert.strictEqual(resolved.root, canonicalRoot);
  assert.strictEqual(resolved.layout, 'source');
  assert.strictEqual(resolved.matrixPath, path.join(canonicalRoot, '.cursor', 'skills', 'conclave-cli', 'references', 'dispatch-matrix.json'));
  assert.strictEqual(resolved.seatProfilesPath, path.join(canonicalRoot, '.cursor', 'skills', 'conclave-cli', 'references', 'seat-profiles.json'));
  assert.ok(fs.existsSync(resolved.matrixPath));
  assert.ok(fs.existsSync(resolved.seatProfilesPath));
  assert.strictEqual(resolved.toolsDir, path.join(canonicalRoot, 'tools'));
  assert.strictEqual(resolved.seatSkillsRoot, path.join(canonicalRoot, 'seat-skills'));
});

test('detects an installed layout (skills/conclave-cli/references, no .cursor)', () => {
  const root = temp();
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  writeReferences(path.join(root, 'skills', 'conclave-cli', 'references'));
  const resolved = resolveRuntimePaths({ root });
  const canonicalRoot = fs.realpathSync.native(root);
  assert.strictEqual(resolved.root, canonicalRoot);
  assert.strictEqual(resolved.layout, 'installed');
  assert.strictEqual(resolved.matrixPath, path.join(canonicalRoot, 'skills', 'conclave-cli', 'references', 'dispatch-matrix.json'));
  assert.strictEqual(resolved.seatProfilesPath, path.join(canonicalRoot, 'skills', 'conclave-cli', 'references', 'seat-profiles.json'));
  assert.strictEqual(resolved.templatesDir, path.join(canonicalRoot, 'tools', 'templates'));
  assert.strictEqual(resolved.seatSkillsRoot, path.join(canonicalRoot, 'seat-skills'));
});

test('canonical paths preserve missing suffixes and detect actual containment', () => {
  const root = temp();
  const missing = path.join(root, 'one', 'two');
  assert.strictEqual(canonicalPlainPath(missing), path.join(fs.realpathSync.native(root), 'one', 'two'));
  assert.strictEqual(pathsOverlap(root, missing), true);
  assert.strictEqual(pathsOverlap(missing, root), true);
  assert.strictEqual(pathsOverlap(root, root), true);
  assert.strictEqual(pathsOverlap(root, `${root}-sibling`), false);
  assert.strictEqual(pathsOverlap(path.join(root, 'one'), path.join(root, 'two')), false);
  assert.strictEqual(pathsOverlap(root, path.join(root, '..named')), true);
});

test('canonical paths reject junction roots, junction ancestors, and file parents', () => {
  const root = temp();
  const real = path.join(root, 'real');
  const link = path.join(root, 'link');
  fs.mkdirSync(real);
  fs.symlinkSync(real, link, 'junction');
  assert.throws(() => canonicalPlainPath(link), /symlink|junction/);
  assert.throws(() => canonicalPlainPath(path.join(link, 'missing')), /symlink|junction/);
  const file = path.join(real, 'file');
  fs.writeFileSync(file, '', 'utf8');
  assert.throws(() => canonicalPlainPath(path.join(file, 'child')), /not a directory/);
});

// macOS ships /tmp and /var as root-level aliases for /private/...; the temp root
// must stay usable through them, while deeper links keep failing (test above).
test('a root-level platform alias resolves instead of failing the temp root', () => {
  const root = temp();
  assert.strictEqual(canonicalPlainPath(root), fs.realpathSync.native(root));
  assert.strictEqual(canonicalPlainPath(os.tmpdir()), fs.realpathSync.native(os.tmpdir()));
});

test('reference contracts must be regular files', () => {
  const root = temp();
  fs.mkdirSync(path.join(root, 'tools'));
  const references = path.join(root, 'skills', 'conclave-cli', 'references');
  writeReferences(references);
  const file = path.join(references, 'dispatch-matrix.json');
  fs.unlinkSync(file);
  fs.mkdirSync(file);
  assert.throws(() => resolveRuntimePaths({ root }), /cannot locate/);
});

test('explicit empty environment cannot inherit a rules root', () => {
  assert.throws(() => resolveRulesRoot({ env: {} }), /CONCLAVE_RULES_ROOT/);
  assert.strictEqual(resolveRulesRoot({ env: { CONCLAVE_RULES_ROOT: 'rules' } }), path.resolve('rules'));
});

test('detects a source layout (.cursor/skills/conclave-cli/references)', () => {
  const root = temp();
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  writeReferences(path.join(root, '.cursor', 'skills', 'conclave-cli', 'references'));
  const resolved = resolveRuntimePaths({ root });
  assert.strictEqual(resolved.layout, 'source');
});

test('fails closed when neither layout has the required contracts', () => {
  const root = temp();
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  assert.throws(
    () => resolveRuntimePaths({ root }),
    (error) => error.code === 'RUNTIME_PATHS_FAIL' && /cannot locate CONCLAVE CLI reference contracts/.test(error.message),
  );
});

test('fails closed when a layout is missing one of the two required files', () => {
  const root = temp();
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'conclave-cli', 'references'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'conclave-cli', 'references', 'dispatch-matrix.json'), '{}\n', 'utf8');
  assert.throws(() => resolveRuntimePaths({ root }), /cannot locate CONCLAVE CLI reference contracts/);
});

test('rejects an ambiguous root with both layouts present', () => {
  const root = temp();
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  writeReferences(path.join(root, 'skills', 'conclave-cli', 'references'));
  writeReferences(path.join(root, '.cursor', 'skills', 'conclave-cli', 'references'));
  assert.throws(
    () => resolveRuntimePaths({ root }),
    (error) => error.code === 'RUNTIME_PATHS_FAIL' && /ambiguous CONCLAVE CLI runtime layout/.test(error.message),
  );
});

test('fails closed when the tools directory itself is missing', () => {
  const root = temp();
  writeReferences(path.join(root, 'skills', 'conclave-cli', 'references'));
  assert.throws(() => resolveRuntimePaths({ root }), /CONCLAVE CLI runtime tools directory missing/);
});

test('fails closed when the root does not exist', () => {
  assert.throws(() => resolveRuntimePaths({ root: path.join(temp(), 'nope') }), /CONCLAVE CLI runtime root does not exist/);
});

test('resolveRulesRoot never falls back to a source checkout: it needs an explicit rulesRoot or CONCLAVE_RULES_ROOT', () => {
  const previous = process.env.CONCLAVE_RULES_ROOT;
  delete process.env.CONCLAVE_RULES_ROOT;
  try {
    assert.throws(() => resolveRulesRoot({}), /CONCLAVE_RULES_ROOT/);
    assert.strictEqual(resolveRulesRoot({ defaultRulesRoot: '/opt/default/rules' }), path.resolve('/opt/default/rules'));
    assert.strictEqual(resolveRulesRoot({ rulesRoot: '/opt/explicit/rules', defaultRulesRoot: '/opt/default/rules' }), path.resolve('/opt/explicit/rules'));
    process.env.CONCLAVE_RULES_ROOT = '/opt/env/rules';
    assert.strictEqual(resolveRulesRoot({ defaultRulesRoot: '/opt/default/rules' }), path.resolve('/opt/env/rules'));
  } finally {
    if (previous === undefined) delete process.env.CONCLAVE_RULES_ROOT;
    else process.env.CONCLAVE_RULES_ROOT = previous;
  }
});
