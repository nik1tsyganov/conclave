'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { allowedWorkspace, anthropicLaunch, googleLaunch, openaiLaunch } = require('./cli-adapters.js');

function brief(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-adapter-'));
  const file = path.join(dir, 'BRIEF.md');
  fs.writeFileSync(file, 'test brief', 'utf8');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return file;
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

test('OpenAI reviewer is read-only while implementer is workspace-write', (t) => {
  const b = brief(t);
  const common = { briefPath: b, cwd: 'C:\\src\\product-a', model: 'gpt-5.6-sol', effort: 'high', capturePath: path.join(path.dirname(b), 'capture.txt'), env: fakeBins, mustExistBinary: false };
  const review = openaiLaunch({ ...common, role: 'review' });
  const implement = openaiLaunch({ ...common, role: 'implement' });
  assert.ok(review.args.includes('read-only'));
  assert.ok(implement.args.includes('workspace-write'));
});

test('Google reviewer uses sandbox while implementer uses write bypass', (t) => {
  const b = brief(t);
  const common = { briefPath: b, cwd: 'C:\\src\\product-a', model: 'gemini-3.1-pro-high', env: fakeBins, home: 'C:\\Users\\test', mustExistBinary: false };
  const review = googleLaunch({ ...common, role: 'review' });
  const implement = googleLaunch({ ...common, role: 'implement' });
  assert.ok(review.args.includes('--sandbox'));
  assert.ok(implement.args.includes('--dangerously-skip-permissions'));
});

test('Claude reviewer does not inherit implement bypassPermissions', (t) => {
  const b = brief(t);
  const common = { briefPath: b, cwd: 'C:\\src\\product-a', model: 'fable', effort: 'xhigh', env: fakeBins, mustExistBinary: false };
  const review = anthropicLaunch({ ...common, role: 'review' });
  const implement = anthropicLaunch({ ...common, role: 'implement' });
  assert.strictEqual(review.permissionMode, 'plan');
  assert.strictEqual(implement.permissionMode, 'bypassPermissions');
});
