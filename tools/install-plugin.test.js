// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const { describe, it } = require('node:test');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const {
  conclaveCursorManifest,
  conclaveCliManifest,
  writeManifest,
  readInstalledManifest,
  CLI_RUNTIME_TOOLS,
  installConclaveCursorCli,
  checkConclaveCli,
} = require('./install-plugin.js');
const {
  INSTALLED_CONCLAVE_SURFACE,
  INSTALLED_CONCLAVE_CLI_SURFACE,
  checkManifestSurface,
} = require('./plugin-surface.js');

describe('install-plugin manifests', () => {
  it('writes Conclave-style surface paths for the installed conclave plugin', () => {
    const manifest = conclaveCursorManifest();
    const surface = checkManifestSurface(manifest, INSTALLED_CONCLAVE_SURFACE);
    assert.strictEqual(surface.ok, true, surface.error);
    assert.strictEqual(manifest.skills, './skills/');
    assert.strictEqual(manifest.rules, './rules/');
    assert.strictEqual(manifest.agents, './agents/');
    assert.strictEqual(manifest.commands, './commands/');
  });

  it('writes skills/rules/commands and omits agents for conclave-cursor-cli', () => {
    const manifest = conclaveCliManifest();
    const surface = checkManifestSurface(manifest, INSTALLED_CONCLAVE_CLI_SURFACE);
    assert.strictEqual(surface.ok, true, surface.error);
    assert.strictEqual(Object.hasOwn(manifest, 'agents'), false);
  });

  it('fails the surface check when an installer-written field is missing', () => {
    const stripped = { ...conclaveCursorManifest() };
    delete stripped.skills;
    const surface = checkManifestSurface(stripped, INSTALLED_CONCLAVE_SURFACE);
    assert.strictEqual(surface.ok, false);
    assert.match(surface.error, /skills/);

    const withAgents = { ...conclaveCliManifest(), agents: './agents/' };
    const cli = checkManifestSurface(withAgents, INSTALLED_CONCLAVE_CLI_SURFACE);
    assert.strictEqual(cli.ok, false);
    assert.match(cli.error, /agents/);
  });

  it('persists surface fields into the dest plugin.json', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'install-plugin-'));
    try {
      writeManifest(dir, conclaveCursorManifest());
      const written = readInstalledManifest(dir);
      assert.strictEqual(written.ok, true, written.error);
      assert.deepStrictEqual(written.manifest, conclaveCursorManifest());
      assert.strictEqual(
        readFileSync(path.join(dir, '.cursor-plugin', 'plugin.json'), 'utf8'),
        `${JSON.stringify(conclaveCursorManifest(), null, 2)}\n`,
      );
    } finally {
      assert.strictEqual(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function disposable(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'conclave-install-safety-'));
  t.after(() => {
    assert.strictEqual(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function put(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
}
function sourceFixture(t) {
  const root = disposable(t);
  const source = path.join(root, 'source');
  const installed = path.join(root, 'installed');
  const repo = path.resolve(__dirname, '..');
  const entries = ['.cursor/skills/conclave-cli', '.cursor/rules', 'commands/conclave-cli.md', 'seat-skills',
    'standing-rules', 'skill-sources.json', 'tools/templates', 'tools/install-plugin.js', ...CLI_RUNTIME_TOOLS.map(name => `tools/${name}`)];
  for (const relative of entries) {
    const from = path.join(repo, relative);
    const to = path.join(source, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
  }
  put(path.join(source, 'sentinel.txt'), 'source must survive');
  return { root, source, installed };
}
function install(f, destination = f.installed) { return installConclaveCursorCli({ sourceRoot: f.source, destination }); }
function snapshot(root, prefix = '') {
  if (!fs.existsSync(root)) return [];
  const entries = [];
  for (const item of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, item.name);
    const relative = `${prefix}${item.name}`;
    if (item.isSymbolicLink()) entries.push([relative, 'link', fs.readlinkSync(file)]);
    else if (item.isDirectory()) entries.push([relative, 'dir'], ...snapshot(file, `${relative}/`));
    else entries.push([relative, fs.readFileSync(file).toString('base64')]);
  }
  return entries;
}

for (const relation of ['same', 'child', 'parent', 'normalized']) {
  test(`installer refuses ${relation} source overlap before writes`, t => {
    const f = sourceFixture(t);
    const before = snapshot(f.root);
    const destinations = { same: f.source, child: path.join(f.source, 'not-created', 'out'), parent: f.root,
      normalized: path.join(f.source, '..', 'source') };
    assert.throws(() => install(f, destinations[relation]), /overlap/);
    assert.deepStrictEqual(snapshot(f.root), before);
    assert.strictEqual(fs.readFileSync(path.join(f.source, 'sentinel.txt'), 'utf8'), 'source must survive');
  });
}

test('installer refuses source junctions and unrelated existing directories before writes', t => {
  const f = sourceFixture(t);
  put(path.join(f.installed, 'sentinel'), 'keep');
  const before = snapshot(f.root);
  assert.throws(() => install(f), /unrelated/);
  assert.deepStrictEqual(snapshot(f.root), before);
  const link = path.join(f.root, 'source-link');
  fs.symlinkSync(f.source, link, 'junction');
  assert.throws(() => installConclaveCursorCli({ sourceRoot: link, destination: path.join(f.root, 'new') }), /symlink|junction/);
  assert.strictEqual(fs.existsSync(path.join(f.root, 'new')), false);
});

test('CLI installs into an empty directory and safely reinstalls known plugin content', t => {
  const f = sourceFixture(t);
  fs.mkdirSync(f.installed);
  assert.strictEqual(install(f), fs.realpathSync.native(f.installed));
  checkConclaveCli(f.installed);
  put(path.join(f.source, 'commands', 'conclave-cli.md'), '# changed command\n');
  install(f);
  checkConclaveCli(f.installed);
  assert.strictEqual(fs.readFileSync(path.join(f.installed, 'commands', 'conclave-cli.md'), 'utf8'), '# changed command\n');
  assert.strictEqual(fs.existsSync(path.join(f.installed, 'sentinel.txt')), false);
  for (const name of ['plan-seal.js', 'model-probe.js', 'probe-evidence.js', 'vendor-native.js', 'run-finalize.js', 'panel-tally.js', 'plugin-surface.js']) {
    assert.deepStrictEqual(fs.readFileSync(path.join(f.installed, 'tools', name)), fs.readFileSync(path.join(f.source, 'tools', name)));
  }
});

for (const added of ['file', 'empty-directory', 'nested-junction', 'malformed-manifest']) {
  test(`reinstall preserves unknown destination ${added}`, t => {
    const f = sourceFixture(t);
    install(f);
    if (added === 'file') put(path.join(f.installed, 'my-notes.txt'), 'keep');
    else if (added === 'empty-directory') fs.mkdirSync(path.join(f.installed, 'my-empty-directory'));
    else if (added === 'nested-junction') fs.symlinkSync(f.source, path.join(f.installed, 'tools', 'link'), 'junction');
    else put(path.join(f.installed, '.cursor-plugin', 'plugin.json'), JSON.stringify({ name: 'conclave-cursor-cli', repository: conclaveCliManifest().repository }));
    const before = snapshot(f.root);
    assert.throws(() => install(f), /unrelated|symlink|junction/);
    assert.deepStrictEqual(snapshot(f.root), before);
  });
}

for (const missing of ['tools/run-finalize.js', 'seat-skills/testing/SKILL.md', '.cursor/skills/conclave-cli/references/seat-profiles.json']) {
  test(`missing source ${missing} preserves a previous install`, t => {
    const f = sourceFixture(t);
    install(f);
    fs.unlinkSync(path.join(f.source, missing));
    const before = snapshot(f.root);
    assert.throws(() => install(f), /ENOENT|missing required|missing bundled/);
    assert.deepStrictEqual(snapshot(f.root), before);
    checkConclaveCli(f.installed);
  });
}

test('check rejects a bundled SKILL.md directory', t => {
  const f = sourceFixture(t);
  install(f);
  const skill = path.join(f.installed, 'seat-skills', 'testing', 'SKILL.md');
  fs.unlinkSync(skill);
  fs.mkdirSync(skill);
  assert.throws(() => checkConclaveCli(f.installed), /bundled seat skill/);
});

test('--destination install and --check affect only the requested plugin directory', t => {
  const f = sourceFixture(t);
  const home = path.join(f.root, 'home');
  put(path.join(home, 'sentinel'), 'keep');
  const before = snapshot(home);
  const run = args => spawnSync(process.execPath, [path.join(f.source, 'tools', 'install-plugin.js'), ...args], {
    cwd: f.root, env: { ...process.env, HOME: home, USERPROFILE: home },
    input: '', encoding: 'utf8', timeout: 30000, shell: false,
  });
  for (const args of [['--destination', f.installed], ['--destination', f.installed, '--check']]) {
    const result = run(args);
    assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
    assert.deepStrictEqual(snapshot(home), before);
    checkConclaveCli(f.installed);
  }
  const installedBefore = snapshot(f.installed);
  for (const args of [['--check'], ['--destination'], ['--destination', f.installed, '--unexpected']]) {
    const result = run(args);
    assert.strictEqual(result.status, 2, result.stderr);
    assert.deepStrictEqual(snapshot(home), before);
    assert.deepStrictEqual(snapshot(f.installed), installedBefore);
  }
});

test('installed runtime loads contracts, all entry-point dependencies, and bundled skills without source', t => {
  const f = sourceFixture(t);
  install(f);
  const moved = path.join(f.root, 'source-unavailable');
  assert.strictEqual(path.dirname(f.source), f.root);
  assert.strictEqual(path.dirname(moved), f.root);
  fs.renameSync(f.source, moved);
  assert.strictEqual(fs.existsSync(f.source), false);
  const home = path.join(f.root, 'home');
  put(path.join(home, '.claude', 'skills', 'testing', 'SKILL.md'), 'wrong full home skill');
  const staged = path.join(f.root, 'staged');
  const script = `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    const Module = require('node:module');
    const child = require('node:child_process');
    for (const name of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) child[name] = () => { throw new Error('native calls forbidden'); };
    const resolve = Module._resolveFilename;
    Module._resolveFilename = function (...args) {
      const found = resolve.apply(this, args);
      if (path.isAbsolute(found)) {
        const relative = path.relative(process.cwd(), found);
        assert.ok(relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'dependency outside installed runtime: ' + found);
      }
      return found;
    };
    const names = ['dispatch-matrix', 'seat-policy', 'dispatch-run', 'cli-skill-stage', 'plan-seal', 'model-probe', 'probe-evidence', 'vendor-native', 'run-finalize', 'panel-tally', 'conclave-cli-preflight', 'plugin-surface'];
    for (const name of names) require(path.join(process.cwd(), 'tools', name + '.js'));
    const runtime = require('./tools/runtime-paths.js').resolveRuntimePaths();
    assert.equal(runtime.layout, 'installed');
    const matrix = require('./tools/dispatch-matrix.js').loadMatrix();
    const profiles = require('./tools/seat-policy.js').loadProfiles();
    assert.ok(matrix.classes && profiles.baseSkills);
    const skills = [...new Set(['baseSkills', 'roleSkills', 'classSkills'].flatMap(key => Object.values(profiles[key]).flat()))];
    const api = require('./tools/cli-skill-stage.js');
    const stage = api.stageSeatSkills({ skills, destinationRoot: process.env.TEST_STAGE });
    assert.equal(api.verifySeatSkills({ skills, destinationRoot: stage.root, manifest: stage.manifest }).ok, true);
    for (const skill of skills) assert.deepEqual(fs.readFileSync(path.join(stage.root, skill, 'SKILL.md')), fs.readFileSync(path.join(runtime.seatSkillsRoot, skill, 'SKILL.md')));
    const templates = fs.readdirSync(runtime.templatesDir);
    assert.ok(templates.length > 0);
    console.log(JSON.stringify({ importedModules: names.length, skills: skills.length, templates: templates.length, layout: runtime.layout, nativeCalls: 0 }));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: f.installed, env: { ...process.env, HOME: home, USERPROFILE: home, TEST_STAGE: staged },
    input: '', encoding: 'utf8', timeout: 30000, shell: false,
  });
  assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
  const evidence = JSON.parse(result.stdout);
  assert.strictEqual(evidence.layout, 'installed');
  assert.strictEqual(evidence.nativeCalls, 0);
  assert.ok(evidence.skills >= 9);
  t.diagnostic(JSON.stringify(evidence));
});

test('documented startup command works without source or home policy in an isolated CLI install', t => {
  const f = sourceFixture(t);
  install(f);
  const moved = path.join(f.root, 'source-unavailable');
  assert.strictEqual(path.dirname(f.source), f.root);
  assert.strictEqual(path.dirname(moved), f.root);
  fs.renameSync(f.source, moved);
  const home = path.join(f.root, 'empty-home');
  fs.mkdirSync(home);
  const guard = path.join(f.root, 'startup-guard.cjs');
  put(guard, `
    const fs = require('node:fs');
    const path = require('node:path');
    const Module = require('node:module');
    const child = require('node:child_process');
    const installedRoot = fs.realpathSync.native(process.cwd());
    const within = file => { const rel = path.relative(installedRoot, fs.realpathSync.native(file)); if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('read outside installed runtime: ' + file); };
    const read = fs.readFileSync;
    fs.readFileSync = function(file, ...args) { within(path.resolve(String(file))); return read.call(this, file, ...args); };
    const resolve = Module._resolveFilename;
    Module._resolveFilename = function(...args) { const file = resolve.apply(this, args); if (path.isAbsolute(file)) within(file); return file; };
    for (const name of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) child[name] = () => { throw new Error('child calls forbidden'); };
  `);
  const before = snapshot(f.installed);
  const command = 'node tools/conclave-whoami.js --mode cursor-cli --slug cursor-grok-4.6-high-fast';
  const result = spawnSync(process.execPath, command.split(' ').slice(1), {
    cwd: f.installed, env: { ...process.env, HOME: home, USERPROFILE: home, NODE_OPTIONS: `--require "${guard.replaceAll('\\', '/')}"` },
    input: '', encoding: 'utf8', timeout: 30000, shell: false,
  });
  assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /^LEGAL\b/);
  assert.match(result.stdout, /declaration only.*not proof of the actual picker/i);
  const guide = fs.readFileSync(path.join(f.installed, 'skills/conclave-cli/references/cursor-cli.md'), 'utf8');
  assert.ok(guide.includes(command), 'the tested startup command must appear literally in the installed guide');
  assert.deepStrictEqual(snapshot(f.installed), before);
  assert.deepStrictEqual(snapshot(home), []);
  assert.strictEqual(fs.existsSync(f.source), false);
  t.diagnostic(JSON.stringify({ command, exitCode: result.status, stdout: result.stdout.trim(), sourceAvailable: false, homeFiles: 0 }));
});

// The installed layout flattens `.cursor/rules` to `rules/`, which is the Cursor .mdc set
// and not the standing-rules pack. The pack travels under its own name so the runtime's
// default root resolves to a pack rather than to four .mdc files (2026-09-18).
test('an installed runtime carries its own standing-rules pack, distinct from the Cursor rules', t => {
  const f = sourceFixture(t);
  fs.mkdirSync(f.installed);
  install(f);
  const pack = path.join(f.installed, 'standing-rules');
  assert.ok(fs.existsSync(path.join(pack, 'STANDING.md')), 'installed pack has STANDING.md');
  assert.ok(fs.existsSync(path.join(pack, 'RULES', 'INDEX.md')), 'installed pack has RULES/INDEX.md');
  assert.ok(fs.existsSync(path.join(f.installed, 'rules', 'conclave-arbiter.mdc')), 'installed Cursor rules are still rules/');
  assert.strictEqual(fs.existsSync(path.join(f.installed, 'rules', 'STANDING.md')), false, 'the two never share a directory');

  const brief = path.join(f.root, 'brief', 'BRIEF.md');
  put(brief, 'brief\n');
  const staged = require('./cli-rules-stage.js').stageRules({ briefPath: brief, rulesRoot: pack });
  assert.strictEqual(staged.rulesRoot, fs.realpathSync(pack));
});
