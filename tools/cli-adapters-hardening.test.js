'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { allowedWorkspace, anthropicLaunch, googleLaunch, openaiLaunch } = require('./cli-adapters.js');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-adapter-'));
  const briefPath = path.join(dir, 'BRIEF.md');
  const seatContractPath = path.join(dir, 'SEAT-CONTRACT.md');
  const skillRoot = path.join(dir, 'skills');
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(briefPath, 'test brief', 'utf8');
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
  for (const role of ['review', 'verify', 'plan', 'research']) assert.strictEqual(anthropicLaunch({ ...common, role }).permissionMode, 'plan');
  assert.strictEqual(anthropicLaunch({ ...common, role: 'implement' }).permissionMode, 'bypassPermissions');
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
  assert.ok(claude.args.includes(path.resolve(f.skillRoot)));
  assert.ok(!google.args.includes('C:\\Users\\test\\.claude\\skills'));
});
