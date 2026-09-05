'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { nativeLog } = require('./vendor-native.js');
const { parseGoogle } = require('./cli-proof.js');

test('Google collector uses the dispatch log when simultaneous native home logs collide', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-native-log-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const homeLogs = path.join(root, '.gemini', 'antigravity-cli', 'log'); fs.mkdirSync(homeLogs, { recursive: true });
  const id = 'current-native-conversation';
  fs.writeFileSync(path.join(homeLogs, 'cli-shared-second.log'), `Print mode: starting (model="wrong-model", conversationID="")\nPrint mode: conversation=other-id, sending message\nUnrelated completion: ${id}\n`);
  const nativeLogPath = path.join(root, 'isolated-native.log');
  const native = `native printmode.go:173] Print mode: starting (model="gemini-3.1-pro-high", conversationID="")\nnative session.go:171] Print mode: conversation=${id}, sending message\n`;
  fs.writeFileSync(nativeLogPath, native);
  const collected = nativeLog('google', JSON.stringify({ conversation_id: id }), '', { home: root, nativeLogPath });
  assert.ok(collected.includes(native.trim()));
  assert.ok(!collected.includes('wrong-model'));
  fs.writeFileSync(nativeLogPath, 'another conversation only');
  assert.throws(() => nativeLog('google', JSON.stringify({ conversation_id: id }), '', { home: root, nativeLogPath }), /does not contain its native conversation/);
  fs.unlinkSync(nativeLogPath);
  assert.throws(() => nativeLog('google', JSON.stringify({ conversation_id: id }), '', { home: root, nativeLogPath }), /ENOENT/);
});

test('Google collection preserves conflicting native conversation creation evidence', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-native-conflict-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nativeLogPath = path.join(root, 'native-cli.log');
  const id = '10000000-0000-4000-8000-000000000001';
  const capture = JSON.stringify({ status: 'SUCCESS', conversation_id: id, response: 'complete', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
  const lines = [
    'ERROR: logging before google.Init: I0905 12:00:00.000000       1 printmode.go:173] Print mode: starting (promptLength=100, model="gemini-3.1-pro-high", conversationID="")',
    'ERROR: logging before google.Init: I0905 12:00:00.500000       1 server.go:171] Created conversation 20000000-0000-4000-8000-000000000002',
    `ERROR: logging before google.Init: I0905 12:00:01.000000       1 session.go:171] Print mode: conversation=${id}, sending message`,
  ];
  fs.writeFileSync(nativeLogPath, lines.join('\n'));
  assert.throws(() => parseGoogle(capture, lines.join('\n'), 'gemini-3.1-pro-high'), /observed model|ambiguous|conversation/i);
  const collected = nativeLog('google', capture, '', { nativeLogPath });
  assert.ok(collected.includes(lines[1]));
  assert.throws(() => parseGoogle(capture, collected, 'gemini-3.1-pro-high'), /observed model|ambiguous|conversation/i);
});
