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
  magiCursorManifest,
  magiCliManifest,
  writeManifest,
  readInstalledManifest,
  CLI_RUNTIME_TOOLS,
  CLI_DASHBOARD_FILES,
  installMagiCursor,
  installMagiCursorCli,
  checkMagiCli,
} = require('./install-plugin.js');
const {
  INSTALLED_MAGI_SURFACE,
  INSTALLED_MAGI_CLI_SURFACE,
  checkManifestSurface,
} = require('./plugin-surface.js');

describe('install-plugin manifests', () => {
  it('writes Conclave-style surface paths for the installed magi plugin', () => {
    const manifest = magiCursorManifest();
    const surface = checkManifestSurface(manifest, INSTALLED_MAGI_SURFACE);
    assert.strictEqual(surface.ok, true, surface.error);
    assert.strictEqual(manifest.skills, './skills/');
    assert.strictEqual(manifest.rules, './rules/');
    assert.strictEqual(manifest.agents, './agents/');
    assert.strictEqual(manifest.commands, './commands/');
  });

  it('writes skills/rules/commands and omits agents for magi-cursor-cli', () => {
    const manifest = magiCliManifest();
    const surface = checkManifestSurface(manifest, INSTALLED_MAGI_CLI_SURFACE);
    assert.strictEqual(surface.ok, true, surface.error);
    assert.strictEqual(Object.hasOwn(manifest, 'agents'), false);
  });

  it('fails the surface check when an installer-written field is missing', () => {
    const stripped = { ...magiCursorManifest() };
    delete stripped.skills;
    const surface = checkManifestSurface(stripped, INSTALLED_MAGI_SURFACE);
    assert.strictEqual(surface.ok, false);
    assert.match(surface.error, /skills/);

    const withAgents = { ...magiCliManifest(), agents: './agents/' };
    const cli = checkManifestSurface(withAgents, INSTALLED_MAGI_CLI_SURFACE);
    assert.strictEqual(cli.ok, false);
    assert.match(cli.error, /agents/);
  });

  it('persists surface fields into the dest plugin.json', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'install-plugin-'));
    try {
      writeManifest(dir, magiCursorManifest());
      const written = readInstalledManifest(dir);
      assert.strictEqual(written.ok, true, written.error);
      assert.deepStrictEqual(written.manifest, magiCursorManifest());
      assert.strictEqual(
        readFileSync(path.join(dir, '.cursor-plugin', 'plugin.json'), 'utf8'),
        `${JSON.stringify(magiCursorManifest(), null, 2)}\n`,
      );
    } finally {
      assert.strictEqual(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function disposable(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'magi-install-safety-'));
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
function sourceFixture(t, broad = false) {
  const root = disposable(t);
  const source = path.join(root, 'source');
  const installed = path.join(root, 'installed');
  const repo = path.resolve(__dirname, '..');
  const entries = broad
    ? ['.cursor/skills', '.cursor/rules', 'commands', 'agents', 'seat-skills', 'skill-sources.json', 'tools']
    : ['.cursor/skills/magi-cli', '.cursor/rules', 'commands/magi-cli.md', 'seat-skills',
      'skill-sources.json', 'tools/templates', 'tools/install-plugin.js',
      ...[...CLI_RUNTIME_TOOLS, ...CLI_DASHBOARD_FILES].map(name => `tools/${name}`)];
  for (const relative of entries) {
    const from = path.join(repo, relative);
    const to = path.join(source, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
  }
  put(path.join(source, 'sentinel.txt'), 'source must survive');
  return { root, source, installed };
}

test('broad installer rejects missing operational policy before replacing a working install', t => {
  const { source, installed } = sourceFixture(t, true);
  installMagiCursor({ sourceRoot: source, destination: installed });
  const before = snapshot(installed);
  const file = path.join(source, '.cursor/skills/magi-cli/references/seat-profiles.json');
  const profiles = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete profiles.operationalLessons;
  put(file, JSON.stringify(profiles));
  assert.throws(() => installMagiCursor({ sourceRoot: source, destination: installed }), /operational lesson/i);
  assert.deepStrictEqual(snapshot(installed), before);
});
function install(f, destination = f.installed) { return installMagiCursorCli({ sourceRoot: f.source, destination }); }
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

test('installer rejects Windows case alias of source', { skip: process.platform !== 'win32' }, t => {
  const f = sourceFixture(t);
  const before = snapshot(f.root);
  assert.throws(() => install(f, f.source.toUpperCase()), /overlap/);
  assert.deepStrictEqual(snapshot(f.root), before);
});

for (const suffix of ['.', ' ', '.\\new-child', ' \\new-child']) {
  test(`installer refuses ambiguous Windows destination suffix ${JSON.stringify(suffix)} before writes`, { skip: process.platform !== 'win32' }, t => {
    const f = sourceFixture(t);
    const before = snapshot(f.root);
    assert.throws(() => install(f, f.source + suffix), /ambiguous or unsafe Windows path/);
    assert.deepStrictEqual(snapshot(f.root), before);
  });
}

for (const target of ['source', 'unrelated']) {
  for (const place of ['destination', 'ancestor']) {
    test(`installer rejects ${place} junction to ${target} before writes`, t => {
      const f = sourceFixture(t);
      const unrelated = path.join(f.root, 'unrelated');
      put(path.join(unrelated, 'sentinel'), 'keep');
      const link = path.join(f.root, 'link');
      fs.symlinkSync(target === 'source' ? f.source : unrelated, link, 'junction');
      const before = snapshot(f.root);
      assert.throws(() => install(f, place === 'destination' ? link : path.join(link, 'child')), /symlink|junction/);
      assert.deepStrictEqual(snapshot(f.root), before);
    });
  }
}

test('installer refuses source junctions and unrelated existing directories before writes', t => {
  const f = sourceFixture(t);
  put(path.join(f.installed, 'sentinel'), 'keep');
  const before = snapshot(f.root);
  assert.throws(() => install(f), /unrelated/);
  assert.deepStrictEqual(snapshot(f.root), before);
  const link = path.join(f.root, 'source-link');
  fs.symlinkSync(f.source, link, 'junction');
  assert.throws(() => installMagiCursorCli({ sourceRoot: link, destination: path.join(f.root, 'new') }), /symlink|junction/);
  assert.strictEqual(fs.existsSync(path.join(f.root, 'new')), false);
});

test('CLI installs into an empty directory and safely reinstalls known plugin content', t => {
  const f = sourceFixture(t);
  fs.mkdirSync(f.installed);
  assert.strictEqual(install(f), fs.realpathSync.native(f.installed));
  checkMagiCli(f.installed);
  put(path.join(f.source, 'commands', 'magi-cli.md'), '# changed command\n');
  install(f);
  checkMagiCli(f.installed);
  assert.strictEqual(fs.readFileSync(path.join(f.installed, 'commands', 'magi-cli.md'), 'utf8'), '# changed command\n');
  assert.strictEqual(fs.existsSync(path.join(f.installed, 'sentinel.txt')), false);
  for (const name of ['plan-seal.js', 'model-probe.js', 'probe-evidence.js', 'vendor-native.js', 'run-finalize.js', 'panel-tally.js', 'plugin-surface.js', ...CLI_DASHBOARD_FILES]) {
    assert.deepStrictEqual(fs.readFileSync(path.join(f.installed, 'tools', name)), fs.readFileSync(path.join(f.source, 'tools', name)));
  }
});

test('missing optional dashboard files fail the install check but leave native runtime preflight intact', t => {
  const f = sourceFixture(t);
  install(f);
  const lookalikes = ['dashboard-helper.js', 'magi-dashboard-helper.js'];
  for (const name of lookalikes) put(path.join(f.installed, 'tools', name), 'module.exports = 1;');
  const evidence = require(path.join(f.installed, 'tools', 'dispatch-evidence.js'));
  const before = evidence.runtimeManifest();
  for (const name of fs.readdirSync(path.join(f.installed, 'tools'))) {
    if (name.endsWith('.js') && !name.endsWith('.test.js') && !CLI_DASHBOARD_FILES.includes(name)) {
      assert.ok(before.some(file => file.path === name), `production file is not bound: ${name}`);
    }
  }
  for (const name of CLI_DASHBOARD_FILES) {
    assert.strictEqual(CLI_RUNTIME_TOOLS.includes(name), false);
    assert.strictEqual(before.some(file => file.path === name), false);
    fs.unlinkSync(path.join(f.installed, 'tools', name));
    assert.throws(() => checkMagiCli(f.installed), /magi-cursor-cli missing:/);
  }
  assert.deepStrictEqual(evidence.runtimeManifest(), before);
  const preflight = require(path.join(f.installed, 'tools', 'magi-cli-preflight.js')).check({
    runtimeRoot: f.installed, home: path.join(f.root, 'empty-home'), vendor: 'anthropic',
    env: { MAGI_CLAUDE_BIN: process.execPath },
  });
  assert.strictEqual(preflight.findings.find(row => row.check === 'runtime:files').ok, true);
  assert.doesNotThrow(() => require(path.join(f.installed, 'tools', 'dispatch-run.js')));
  for (const name of lookalikes) {
    put(path.join(f.installed, 'tools', name), 'module.exports = 2;');
    assert.notStrictEqual(evidence.runtimeManifest().find(file => file.path === name).sha256,
      before.find(file => file.path === name).sha256);
  }
});

for (const added of ['file', 'empty-directory', 'nested-junction', 'malformed-manifest']) {
  test(`reinstall preserves unknown destination ${added}`, t => {
    const f = sourceFixture(t);
    install(f);
    if (added === 'file') put(path.join(f.installed, 'my-notes.txt'), 'keep');
    else if (added === 'empty-directory') fs.mkdirSync(path.join(f.installed, 'my-empty-directory'));
    else if (added === 'nested-junction') fs.symlinkSync(f.source, path.join(f.installed, 'tools', 'link'), 'junction');
    else put(path.join(f.installed, '.cursor-plugin', 'plugin.json'), JSON.stringify({ name: 'magi-cursor-cli', repository: magiCliManifest().repository }));
    const before = snapshot(f.root);
    assert.throws(() => install(f), /unrelated|symlink|junction/);
    assert.deepStrictEqual(snapshot(f.root), before);
  });
}

for (const missing of ['tools/run-finalize.js', 'tools/dashboard.html', 'seat-skills/testing/SKILL.md', '.cursor/skills/magi-cli/references/seat-profiles.json']) {
  test(`missing source ${missing} preserves a previous install`, t => {
    const f = sourceFixture(t);
    install(f);
    fs.unlinkSync(path.join(f.source, missing));
    const before = snapshot(f.root);
    assert.throws(() => install(f), /ENOENT|missing required|missing bundled/);
    assert.deepStrictEqual(snapshot(f.root), before);
    checkMagiCli(f.installed);
  });
}

test('check rejects a bundled SKILL.md directory', t => {
  const f = sourceFixture(t);
  install(f);
  const skill = path.join(f.installed, 'seat-skills', 'testing', 'SKILL.md');
  fs.unlinkSync(skill);
  fs.mkdirSync(skill);
  assert.throws(() => checkMagiCli(f.installed), /bundled seat skill/);
});

test('--destination install and --check affect only the requested plugin directory', t => {
  const f = sourceFixture(t);
  const home = path.join(f.root, 'home');
  put(path.join(home, 'sentinel'), 'keep');
  const before = snapshot(home);
  const run = args => spawnSync(process.execPath, [path.join(f.source, 'tools', 'install-plugin.js'), ...args], {
    cwd: f.root, env: { ...process.env, HOME: home, USERPROFILE: home },
    input: '', encoding: 'utf8', timeout: 30000, windowsHide: true, shell: false,
  });
  for (const args of [['--destination', f.installed], ['--destination', f.installed, '--check']]) {
    const result = run(args);
    assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
    assert.deepStrictEqual(snapshot(home), before);
    checkMagiCli(f.installed);
  }
  const installedBefore = snapshot(f.installed);
  for (const args of [['--check'], ['--destination'], ['--destination', f.installed, '--unexpected']]) {
    const result = run(args);
    assert.strictEqual(result.status, 2, result.stderr);
    assert.deepStrictEqual(snapshot(home), before);
    assert.deepStrictEqual(snapshot(f.installed), installedBefore);
  }
});

test('broad Cursor installation excludes tests while retaining every other tool byte', t => {
  const f = sourceFixture(t, true);
  put(path.join(f.source, 'tools', 'nested', 'future-helper.js'), 'module.exports = 42;\n');
  put(path.join(f.source, 'tools', 'nested', 'future-helper.test.js'), 'throw new Error("test must not ship");\n');
  const run = () => installMagiCursor({ sourceRoot: f.source, destination: f.installed });
  run();
  const sourceFiles = snapshot(path.join(f.source, 'tools')).filter(([, body]) => body !== 'dir');
  const expected = sourceFiles.filter(([name]) => !name.endsWith('.test.js') && path.posix.basename(name) !== 'test-fixtures.js');
  const actual = snapshot(path.join(f.installed, 'tools')).filter(([, body]) => body !== 'dir');
  assert.deepStrictEqual(actual.map(([name]) => name), expected.map(([name]) => name));
  for (let index = 0; index < expected.length; index++) assert.ok(actual[index][1] === expected[index][1], `changed tool bytes: ${expected[index][0]}`);
  // A previous broad install included these known source files. Reinstall removes them.
  const legacy = sourceFiles.find(([name]) => name.endsWith('.test.js'))[0];
  fs.copyFileSync(path.join(f.source, 'tools', legacy), path.join(f.installed, 'tools', legacy));
  run();
  assert.strictEqual(fs.existsSync(path.join(f.installed, 'tools', legacy)), false);
  // A test-like filename alone does not authorize deleting unrelated user content.
  put(path.join(f.installed, 'tools', 'owner-notes.test.js'), 'keep');
  const before = snapshot(f.installed);
  assert.throws(run, /unrelated destination file/);
  assert.deepStrictEqual(snapshot(f.installed), before);
  const size = rows => rows.reduce((sum, [, body]) => sum + Buffer.from(body, 'base64').length, 0);
  t.diagnostic(JSON.stringify({ beforeTools: sourceFiles.length, beforeBytes: size(sourceFiles), afterTools: expected.length, afterBytes: size(expected) }));
});

test('missing operational lessons cannot replace a working CLI install', t => {
  const f = sourceFixture(t);
  install(f);
  const file = path.join(f.source, '.cursor/skills/magi-cli/references/seat-profiles.json');
  const profiles = JSON.parse(fs.readFileSync(file, 'utf8'));
  profiles.schemaVersion = 7;
  delete profiles.operationalLessons;
  put(file, JSON.stringify(profiles));
  const before = snapshot(f.installed);
  assert.throws(() => install(f), /operational lesson/i);
  assert.deepStrictEqual(snapshot(f.installed), before);
});

test('installed CLI check rejects removed operational lesson policy', t => {
  const f = sourceFixture(t);
  install(f);
  const file = path.join(f.installed, 'skills/magi-cli/references/seat-profiles.json');
  const profiles = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete profiles.operationalLessons;
  put(file, JSON.stringify(profiles));
  assert.throws(() => checkMagiCli(f.installed), /operational lesson/i);
});

for (const broad of [false, true]) test(`${broad ? 'broad Cursor' : 'CLI'} installed runtime loads contracts, all entry-point dependencies, and bundled skills without source`, t => {
  const f = sourceFixture(t, broad);
  if (broad) installMagiCursor({ sourceRoot: f.source, destination: f.installed });
  else install(f);
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
    const names = ['dispatch-matrix', 'seat-policy', 'dispatch-run', 'cli-skill-stage', 'plan-seal', 'model-probe', 'probe-evidence', 'vendor-native', 'run-finalize', 'panel-tally', 'magi-cli-preflight', 'plugin-surface', 'subscription-capacity', 'benchmark-run', 'benchmark-fixtures', 'project-fixtures'];
    for (const name of names) require(path.join(process.cwd(), 'tools', name + '.js'));
    const runtime = require('./tools/runtime-paths.js').resolveRuntimePaths();
    assert.equal(runtime.layout, 'installed');
    const matrix = require('./tools/dispatch-matrix.js').loadMatrix();
    assert.equal(require('./tools/magi-skill-web.js').loadSourceContract().decision, 'keep-separate');
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
    input: '', encoding: 'utf8', timeout: 30000, windowsHide: true, shell: false,
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
  const command = 'node tools/magi-whoami.js --mode cursor-cli --slug grok-4.6';
  const result = spawnSync(process.execPath, command.split(' ').slice(1), {
    cwd: f.installed, env: { ...process.env, HOME: home, USERPROFILE: home, NODE_OPTIONS: `--require "${guard.replaceAll('\\', '/')}"` },
    input: '', encoding: 'utf8', timeout: 30000, windowsHide: true, shell: false,
  });
  assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /^LEGAL\b/);
  assert.match(result.stdout, /declaration only.*not proof of the actual picker/i);
  const guide = fs.readFileSync(path.join(f.installed, 'skills/magi-cli/references/cursor-cli.md'), 'utf8');
  assert.ok(guide.includes(command), 'the tested startup command must appear literally in the installed guide');
  assert.deepStrictEqual(snapshot(f.installed), before);
  assert.deepStrictEqual(snapshot(home), []);
  assert.strictEqual(fs.existsSync(f.source), false);
  t.diagnostic(JSON.stringify({ command, exitCode: result.status, stdout: result.stdout.trim(), sourceAvailable: false, homeFiles: 0 }));
});

for (const broad of [false, true]) test(`${broad ? 'broad Cursor' : 'CLI'} installed dashboard starts, serves assets and observations, and stops without source or native calls`, t => {
  const f = sourceFixture(t, broad);
  if (broad) installMagiCursor({ sourceRoot: f.source, destination: f.installed });
  else install(f);
  const runDir = path.join(f.root, 'run');
  const plan = JSON.stringify({ planId: 'dashboard-install', hostMode: 'cursor-cli', dispatches: [
    { dispatchId: 'implement-1', unitId: 'unit-1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high' },
  ] });
  put(path.join(runDir, 'dispatch-plan.json'), plan);
  put(path.join(runDir, 'plan-seal.json'), JSON.stringify({ schemaVersion: 2, planId: 'dashboard-install',
    planHash: require('node:crypto').createHash('sha256').update(plan).digest('hex'), sealedAt: '2026-01-01T00:00:00.000Z' }));
  const moved = path.join(f.root, 'source-unavailable');
  assert.strictEqual(path.dirname(f.source), f.root);
  assert.strictEqual(path.dirname(moved), f.root);
  fs.renameSync(f.source, moved);
  const before = snapshot(f.installed), runBefore = snapshot(runDir);
  const script = `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    const Module = require('node:module');
    const http = require('node:http');
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
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = () => { throw new Error('import must not start a listener'); };
    const { startServer } = require('./tools/magi-dashboard.js');
    http.Server.prototype.listen = listen;
    (async () => {
      const dashboard = await startServer({ runDir: process.env.TEST_RUN, port: 0 });
      try {
        const url = new URL(dashboard.url);
        assert.equal(url.hostname, '127.0.0.1');
        assert.equal(new URLSearchParams(url.hash.slice(1)).get('token'), dashboard.token);
        for (const [route, file] of [['/', 'dashboard.html'], ['/dashboard.css', 'dashboard.css'], ['/dashboard.js', 'dashboard.js']]) {
          const response = await fetch(dashboard.origin + route);
          assert.equal(response.status, 200);
          assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join('tools', file)));
        }
        assert.equal((await fetch(dashboard.origin + '/api/snapshot')).status, 401);
        const response = await fetch(dashboard.origin + '/api/snapshot', { headers: { Authorization: 'Bearer ' + dashboard.token } });
        assert.equal(response.status, 200);
        const observed = await response.json();
        assert.equal(observed.run.id, 'dashboard-install');
        assert.equal(observed.dispatches.length, 1);
      } finally {
        const closed = new Promise(resolve => dashboard.server.close(resolve));
        dashboard.server.closeAllConnections();
        await closed;
      }
      assert.equal(dashboard.server.listening, false);
      console.log(JSON.stringify({ sourceAvailable: false, nativeCalls: 0, assets: 3, snapshots: 1, listenerClosed: true }));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: f.installed, env: { ...process.env, TEST_RUN: runDir }, input: '', encoding: 'utf8',
    timeout: 30000, windowsHide: true, shell: false,
  });
  assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
  assert.strictEqual(fs.existsSync(f.source), false);
  assert.deepStrictEqual(snapshot(f.installed), before);
  assert.deepStrictEqual(snapshot(runDir), runBefore);
  const command = 'node tools/magi-dashboard.js --run-dir <sealed-run-directory>';
  for (const relative of ['skills/magi-cli/SKILL.md', 'skills/magi-cli/references/cursor-cli.md']) {
    assert.ok(fs.readFileSync(path.join(f.installed, relative), 'utf8').includes(command));
  }
  t.diagnostic(result.stdout.trim());
});
