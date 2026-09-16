'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
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
    assert.ok(!launch.args.includes('--bare'), 'bare mode disables subscription OAuth');
    assert.ok(!launch.args.includes('--system-prompt'), 'native system controls must remain in place');
    const finalContract = launch.args[launch.args.indexOf('--append-system-prompt') + 1];
    assert.ok(!finalContract.includes('ACK test brief'), 'acknowledgment content stays in the bound brief');
    assert.ok(finalContract.includes("Begin the final response with the brief's exact first line"));
    assert.ok(!finalContract.includes(fs.readFileSync(f.briefPath, 'utf8')), 'the brief body remains on disk');
    assert.ok(!fs.readFileSync(launch.stdinFile, 'utf8').includes('ACK test brief'), 'the pointer carries no brief content');
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

test('Claude pointer and system prompt require a FIRST native Read of the seat contract, not Bash cat', (t) => {
  const f = fixture(t);
  const launch = anthropicLaunch({
    briefPath: f.briefPath, seatContractPath: f.seatContractPath, skillRoot: f.skillRoot,
    cwd: 'C:\\src\\product-a', model: 'fable', effort: 'xhigh', role: 'implement',
    env: fakeBins, mustExistBinary: false,
  });
  const pointer = fs.readFileSync(launch.stdinFile, 'utf8');
  const system = launch.args[launch.args.indexOf('--append-system-prompt') + 1];
  assert.match(pointer, /FIRST use the Read tool/);
  assert.ok(pointer.includes(f.seatContractPath));
  assert.match(pointer, /Do not cat or Bash instruction files/);
  assert.match(system, /with the Read tool before any task work/);
  assert.match(system, /with the Read tool rather than shell commands/);
  assert.ok(pointer.length <= 2000);
});

test('every adapter requires contract-listed reads before product work and treats missing instructions as blockers', (t) => {
  const f = fixture(t);
  for (const build of [openaiLaunch, googleLaunch, anthropicLaunch]) {
    const launch = build({ ...f, cwd: 'C:\\src\\product-a', model: 'fixture', effort: 'high', role: 'verify',
      capturePath: path.join(f.dir, 'capture.txt'), env: fakeBins, mustExistBinary: false });
    const pointer = launch.stdinFile ? fs.readFileSync(launch.stdinFile, 'utf8') : launch.args[launch.args.indexOf('-p') + 1];
    assert.ok(pointer.includes('Complete every required instruction read in that contract before product work.'));
    assert.ok(pointer.includes('If any required instruction is missing or unreadable, stop and report a blocker.'));
    assert.ok(pointer.length <= 2000);
    if (launch.vendor === 'anthropic') {
      const system = launch.args[launch.args.indexOf('--append-system-prompt') + 1];
      assert.ok(system.includes('Complete every instruction read it lists before product work'));
      // Regression guard: this sentence tripped Opus 5's safeguard classifier on every launch (2026-09-16).
      assert.ok(!/permissions still apply|permissions remain in force/i.test(system));
    }
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

test('Google launches drop inherited Synara Antigravity capture environment', (t) => {
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
  assert.ok(!Object.prototype.hasOwnProperty.call(launch.env, 'SYNARA_ANTIGRAVITY_EVENTS'));
  assert.ok(!Object.prototype.hasOwnProperty.call(launch.env, 'SYNARA_ANTIGRAVITY_HOOK_DECISION'));
  assert.strictEqual(launch.env.AGY_CLI_DISABLE_AUTO_UPDATE, 'true');
});
