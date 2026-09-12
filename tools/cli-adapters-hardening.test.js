'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const { allowedWorkspace, anthropicLaunch, googleLaunch, openaiLaunch } = require('./cli-adapters.js');
const { CLAUDE_RESPONSE_PROTOCOL, CLAUDE_RESPONSE_SCHEMA, validateClaudeResponseLaunch } = require('./vendor-native.js');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-adapter-'));
  const briefPath = path.join(dir, 'BRIEF.md');
  const seatContractPath = path.join(dir, 'SEAT-CONTRACT.md');
  const skillRoot = path.join(dir, 'skills');
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(briefPath, 'ACK test brief\nTask details remain in this file.\n', 'utf8');
  fs.writeFileSync(seatContractPath, 'seat contract', 'utf8');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, briefPath, seatContractPath, skillRoot };
}

const fakeBins = {
  MAGI_CODEX_BIN: 'C:\\bin\\codex.exe',
  MAGI_AGY_BIN: 'C:\\bin\\agy.exe',
  MAGI_CLAUDE_BIN: 'C:\\bin\\claude.exe',
  MAGI_DEV_ROOT: 'C:\\src',
};

test('workspace authorization is project-root based rather than magi-repo based', () => {
  assert.strictEqual(allowedWorkspace('C:\\src\\product-a', fakeBins), 'C:\\src\\product-a');
  assert.throws(() => allowedWorkspace('D:\\private', fakeBins), /outside MAGI allowed roots/);
});

test('workspace authorization keeps host-native POSIX paths', { skip: process.platform === 'win32' }, (t) => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'magi-posix-ws-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.strictEqual(allowedWorkspace(root, { MAGI_DEV_ROOT: root }), path.resolve(root));
});

test('Windows workspace authorization compares native short and long path aliases', { skip: process.platform !== 'win32' }, t => {
  const longRoot = fs.realpathSync.native(process.env.ProgramFiles);
  const shortRoot = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:ProgramFiles).ShortPath'],
  { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
  if (shortRoot.toLowerCase() === longRoot.toLowerCase()) return t.skip('Program Files has no native short path alias');
  for (const [cwdRoot, allowedRoot] of [[longRoot, shortRoot], [shortRoot, longRoot]]) {
    const env = { MAGI_DEV_ROOT: allowedRoot };
    assert.strictEqual(allowedWorkspace(cwdRoot, env), cwdRoot);
    const missing = path.join(cwdRoot, 'magi-authorization-fixture', 'workspace');
    assert.strictEqual(allowedWorkspace(missing, env), missing);
    assert.throws(() => allowedWorkspace(`${cwdRoot}-sibling`, env), { code: 'WORKSPACE_FORBIDDEN' });
  }
});

test('Windows workspace authorization rejects junction candidates and allowed roots', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t); const allowed = path.join(f.dir, 'allowed'); const outside = path.join(f.dir, 'outside');
  fs.mkdirSync(allowed); fs.mkdirSync(outside);
  const link = path.join(allowed, 'alias'); fs.symlinkSync(outside, link, 'junction');
  assert.throws(() => allowedWorkspace(path.join(link, 'missing'), { MAGI_DEV_ROOT: allowed }), /symlink|junction/);
  assert.throws(() => allowedWorkspace(outside, { MAGI_DEV_ROOT: link }), /symlink|junction/);
  assert.deepStrictEqual(fs.readdirSync(outside), []);
});

test('OpenAI non-implement roles are read-only while implementer is workspace-write', (t) => {
  const f = fixture(t);
  const common = {
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: 'C:\\src\\product-a', model: 'gpt-5.6-sol', effort: 'high', capturePath: path.join(f.dir, 'capture.txt'),
    env: fakeBins, mustExistBinary: false,
  };
  for (const role of ['review', 'verify', 'plan', 'research']) assert.ok(openaiLaunch({ ...common, role }).args.includes('read-only'));
  assert.ok(openaiLaunch({ ...common, role: 'implement' }).args.includes('workspace-write'));
});

test('Google non-implement roles use sandbox while implementer uses write bypass', (t) => {
  const f = fixture(t);
  const common = {
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: 'C:\\src\\product-a', model: 'gemini-3.1-pro-high', env: fakeBins, home: 'C:\\Users\\test', mustExistBinary: false,
  };
  for (const role of ['review', 'verify', 'plan', 'research']) assert.ok(googleLaunch({ ...common, role }).args.includes('--sandbox'));
  assert.ok(googleLaunch({ ...common, role: 'implement' }).args.includes('--dangerously-skip-permissions'));
});

test('Claude non-implement roles do not inherit implement bypassPermissions', (t) => {
  const f = fixture(t);
  const common = {
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: 'C:\\src\\product-a', model: 'fable', effort: 'xhigh', env: fakeBins, mustExistBinary: false,
  };
  for (const role of ['implement', 'review', 'verify', 'plan', 'research']) {
    const launch = anthropicLaunch({ ...common, role });
    assert.strictEqual(launch.responseProtocol, CLAUDE_RESPONSE_PROTOCOL);
    validateClaudeResponseLaunch(launch);
    assert.deepStrictEqual(JSON.parse(launch.args[launch.args.indexOf('--json-schema') + 1]), CLAUDE_RESPONSE_SCHEMA);
    assert.deepStrictEqual(CLAUDE_RESPONSE_SCHEMA.required, ['response']);
    assert.strictEqual(CLAUDE_RESPONSE_SCHEMA.additionalProperties, false);
    assert.strictEqual(CLAUDE_RESPONSE_SCHEMA.properties.response.type, 'string');
    assert.ok(!JSON.stringify(CLAUDE_RESPONSE_SCHEMA).includes('minLength'));
    assert.strictEqual(launch.permissionMode, role === 'implement' ? 'bypassPermissions' : 'dontAsk');
    assert.ok(launch.args.includes('--safe-mode'), 'global hooks and skills must not override a leaf contract');
    assert.deepStrictEqual(JSON.parse(launch.args[launch.args.indexOf('--settings') + 1]), { switchModelsOnFlag: false, fallbackModel: [] }, 'exact-model runs must preserve refusals and never switch to an unadmitted model');
    assert.ok(!launch.args.includes('--bare'), 'bare mode disables subscription OAuth');
    assert.ok(!launch.args.includes('--system-prompt'), 'native system controls must remain in place');
    assert.ok(!launch.args.includes('--append-system-prompt'));
    assert.strictEqual(launch.args.at(-2), '--');
    assert.strictEqual(launch.stdinFile, undefined);
    assert.deepStrictEqual(launch.stdio, ['ignore', 'pipe', 'pipe']);
    assert.ok(!fs.existsSync(f.briefPath + '.pointer.md'));
    assert.deepStrictEqual(CLAUDE_RESPONSE_SCHEMA.properties.response, { type: 'string' });
    const finalContract = launch.args.at(-1);
    assert.ok(!finalContract.includes('ACK test brief'), 'acknowledgment content stays in the bound brief');
    assert.ok(finalContract.includes("Your FINAL response must start with the brief's exact first line"));
    assert.ok(finalContract.includes('Native permissions still apply'));
    assert.ok(!finalContract.includes(fs.readFileSync(f.briefPath, 'utf8')), 'the brief body remains on disk');
    assert.ok(!finalContract.includes('ACK test brief'), 'the pointer carries no brief content');
    assert.ok(!launch.env.ANTHROPIC_API_KEY);
    if (role !== 'implement') {
      assert.strictEqual(launch.args[launch.args.indexOf('--tools') + 1], 'Read,Glob,Grep');
      assert.strictEqual(launch.args[launch.args.indexOf('--allowedTools') + 1], 'Read,Glob,Grep');
      assert.ok(!launch.args.includes('plan'), 'plan mode requires a separate approval turn');
      for (const forbidden of ['bypassPermissions', 'manual', 'auto', 'acceptEdits', 'plan']) assert.throws(() => anthropicLaunch({ ...common, role, reviewPermissionMode: forbidden }), /read-only Claude roles require/);
    }
  }
});

test('every adapter keeps even a single-line brief body out of launch arguments and pointers', (t) => {
  const f = fixture(t);
  const body = 'PRIVATE_BRIEF_CONTENT_727e4df5';
  fs.writeFileSync(f.briefPath, body);
  for (const build of [openaiLaunch, googleLaunch, anthropicLaunch]) {
    const launch = build({ ...f, cwd: 'C:\\src\\product-a', model: 'fixture', effort: 'high', role: 'implement',
      capturePath: path.join(f.dir, 'capture.txt'), env: fakeBins, mustExistBinary: false });
    assert.ok(!launch.args.some(arg => String(arg).includes(body)));
    if (launch.stdinFile) assert.ok(!fs.readFileSync(launch.stdinFile, 'utf8').includes(body));
  }
});

test('OpenAI first-read recipe uses forward paths and reads an apostrophe path on Windows', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t); const cwd = path.join(f.dir, '.local', "O'Brien [read]"); fs.mkdirSync(cwd, { recursive: true });
  const contract = path.join(cwd, "SEAT'S-CONTRACT.md"); const content = 'exact forward-path read sentinel'; fs.writeFileSync(contract, content);
  const launch = openaiLaunch({ briefPath: f.briefPath, seatContractPath: contract, skillRoot: f.skillRoot, cwd,
    role: 'verify', model: 'gpt-5.6-luna', effort: 'medium', capturePath: path.join(f.dir, 'capture.txt'),
    env: { ...fakeBins, MAGI_ALLOWED_WORKSPACE_ROOTS: f.dir }, mustExistBinary: false });
  const pointer = fs.readFileSync(launch.stdinFile, 'utf8');
  const match = pointer.match(/const r = await tools\.exec_command\((\{[^\n]+\})\); text\(r.output\);/);
  assert.ok(match); const args = JSON.parse(match[1]);
  assert.strictEqual(Object.hasOwn(args, 'workdir'), false); assert.ok(!args.cmd.includes('\\'));
  assert.ok(args.cmd.includes("O''Brien [read]")); assert.ok(args.cmd.includes("SEAT''S-CONTRACT.md"));
  assert.strictEqual(launch.cwd, cwd, 'native launch cwd retains its original canonical form');
  assert.deepStrictEqual(Object.keys(args).sort(), ['cmd', 'max_output_tokens']);
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', args.cmd],
    { cwd: launch.cwd, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.strictEqual(output.trimEnd(), content);
});

test('Claude launch validation rejects changed prompt transport and lost native proof flags', (t) => {
  const f = fixture(t);
  const launch = anthropicLaunch({ ...f, cwd: 'C:\\src\\product-a', role: 'plan',
    env: fakeBins, mustExistBinary: false });
  const mutations = [
    row => { row.stdinFile = f.briefPath; },
    row => { row.stdio[0] = 'pipe'; },
    row => { row.args.splice(-2, 1); },
    row => { row.args.push('extra prompt'); },
    row => { row.args[row.args.length - 1] = ''; },
    row => { row.args.splice(row.args.indexOf('-p'), 1); },
    row => { row.args.splice(row.args.indexOf('--safe-mode'), 1); },
    row => { row.args.splice(row.args.indexOf('--verbose'), 1); },
    row => { row.args[row.args.indexOf('--output-format') + 1] = 'json'; },
    row => { row.args.unshift('--output-format', 'text'); },
    row => { row.args.unshift('--append-system-prompt', 'duplicate instructions'); },
    row => { row.args.unshift('--system-prompt=replace native controls'); },
    row => { row.args.unshift('--bare'); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(launch);
    mutate(changed);
    assert.throws(() => validateClaudeResponseLaunch(changed), /Claude launch/);
  }
});

test('Claude positional pointer requires a FIRST native Read of the seat contract once', (t) => {
  const f = fixture(t);
  const launch = anthropicLaunch({
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: 'C:\\src\\product-a', model: 'fable', effort: 'xhigh', role: 'implement',
    env: fakeBins, mustExistBinary: false,
  });
  const pointer = launch.args.at(-1);
  assert.match(pointer, /FIRST use the Read tool/);
  assert.ok(pointer.includes(f.seatContractPath));
  assert.match(pointer, /Do not cat or Bash instruction files/);
  assert.strictEqual(pointer.split('Read tool').length - 1, 1);
  assert.ok(!launch.args.includes('--append-system-prompt'));
  assert.ok(pointer.length <= 2000);
});

test('every adapter requires contract-listed reads before product work and treats missing instructions as blockers', (t) => {
  const f = fixture(t);
  for (const build of [openaiLaunch, googleLaunch, anthropicLaunch]) {
    const launch = build({ ...f, cwd: 'C:\\src\\product-a', model: 'fixture', effort: 'high', role: 'verify',
      capturePath: path.join(f.dir, 'capture.txt'), env: fakeBins, mustExistBinary: false });
    const pointer = launch.stdinFile ? fs.readFileSync(launch.stdinFile, 'utf8') : launch.args.at(-1);
    assert.ok(pointer.includes('Complete every required instruction read in that contract before product work.'));
    assert.ok(pointer.includes('If any required instruction is missing or unreadable, stop and report a blocker.'));
    assert.ok(pointer.length <= 2000);
    assert.ok(pointer.includes('Native permissions still apply.'));
  }
});

test('oversized seat pointers fail before a pointer file is written', (t) => {
  const f = fixture(t);
  for (const build of [openaiLaunch, googleLaunch, anthropicLaunch]) {
    assert.throws(() => build({ ...f, seatContractPath: 'C:\\src\\' + 'x'.repeat(2100), cwd: 'C:\\src\\product-a',
      model: 'fixture', effort: 'high', role: 'implement', capturePath: path.join(f.dir, 'capture.txt'),
      env: fakeBins, mustExistBinary: false }), /2000-character delivery limit/);
    assert.ok(!fs.existsSync(f.briefPath + '.pointer.md'));
  }
});

test('Google and Claude launchers mount only staged seat skill root, not full global skill tree', (t) => {
  const f = fixture(t);
  const google = googleLaunch({
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: 'C:\\src\\product-a', model: 'gemini-3.1-pro-high', role: 'research', env: fakeBins, mustExistBinary: false,
  });
  const claude = anthropicLaunch({
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: 'C:\\src\\product-a', model: 'fable', effort: 'xhigh', role: 'review', env: fakeBins, mustExistBinary: false,
  });
  assert.ok(google.args.includes(path.resolve(f.skillRoot)));
  assert.strictEqual(google.args[google.args.indexOf('--log-file') + 1], path.join(f.dir, 'native-cli.log'));
  assert.strictEqual(google.nativeLogPath, path.join(f.dir, 'native-cli.log'));
  assert.ok(claude.args.includes(path.resolve(f.skillRoot)));
  assert.ok(!google.args.includes('C:\\Users\\test\\.claude\\skills'));
});

test('Google launches replace inherited Synara capture with a local diagnostic stream', (t) => {
  const f = fixture(t);
  const launch = googleLaunch({
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: 'C:\\src\\product-a', model: 'gemini-3.1-pro-high', role: 'research', mustExistBinary: false,
    env: {
      ...fakeBins,
      SYNARA_ANTIGRAVITY_EVENTS: 'C:\\tmp\\synara-events.ndjson',
      SYNARA_ANTIGRAVITY_HOOK_DECISION: 'ask',
    },
  });
  assert.strictEqual(launch.env.SYNARA_ANTIGRAVITY_EVENTS, path.join(f.dir, 'synara-capture-events.jsonl'));
  assert.strictEqual(launch.env.SYNARA_ANTIGRAVITY_HOOK_DECISION, 'allow');
  assert.strictEqual(launch.synaraCaptureEventsPath, launch.env.SYNARA_ANTIGRAVITY_EVENTS);
  assert.strictEqual(launch.synaraCaptureEventsTrust, 'diagnostic-untrusted');
  assert.strictEqual(launch.env.AGY_CLI_DISABLE_AUTO_UPDATE, 'true');
});
