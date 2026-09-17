// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with section 7 terms; see LICENSE.
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

test('Google collection deduplicates only the same complete native identity sequence across channels', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-native-mirror-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nativeLogPath = path.join(root, 'native-cli.log');
  const id = '10000000-0000-4000-8000-000000000001';
  const capture = JSON.stringify({ status: 'SUCCESS', conversation_id: id, response: 'complete', usage: { total_tokens: 2 } });
  const native = `I0905 12:00:00.000000       1 printmode.go:173] Print mode: starting (model="gemini-3.1-pro-high", conversationID="${id}")\nI0905 12:00:01.000000       1 session.go:171] Print mode: conversation=${id}, sending message\n`;
  fs.writeFileSync(nativeLogPath, native, 'utf8');
  const base = `stderr diagnostic\n${native}`;
  const collected = nativeLog('google', capture, base, { nativeLogPath });
  assert.equal(collected, base);
  assert.equal(parseGoogle(capture, collected, 'gemini-3.1-pro-high').conversationId, id);
  assert.equal(parseGoogle(capture, nativeLog('google', capture, '', { nativeLogPath }), 'gemini-3.1-pro-high').conversationId, id);
  const homeLogs = path.join(root, '.gemini', 'antigravity-cli', 'log');
  fs.mkdirSync(homeLogs, { recursive: true });
  fs.writeFileSync(path.join(homeLogs, 'cli-fixture.log'), native, 'utf8');
  assert.equal(nativeLog('google', capture, base, { home: root }), base);
  for (const conflict of [native + native, native.replace('gemini-3.1-pro-high', 'wrong-model'), native.replace('12:00:00.', '12:00:02.')]) {
    fs.writeFileSync(nativeLogPath, conflict, 'utf8');
    assert.throws(() => parseGoogle(capture, nativeLog('google', capture, base, { nativeLogPath }), 'gemini-3.1-pro-high'), /ambiguous|conflicting/);
  }
  fs.writeFileSync(nativeLogPath, native, 'utf8');
  assert.throws(() => parseGoogle(capture, nativeLog('google', capture, native + native, { nativeLogPath }), 'gemini-3.1-pro-high'), /ambiguous|conflicting/);
});

test('production Google dispatch rejects SUCCESS with error and accepts mirrored pinned identity', async t => {
  const { createSealedRun, fakeVendor, completeSyntheticDispatch } = require('./test-fixtures.js');
  const { inspectRun } = require('./run-finalize.js');
  for (const failed of [true, false]) {
    const run = createSealedRun(t, [{ vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high', role: 'review', class: 'review-adversarial', authorVendor: 'openai' }]);
    const native = fakeVendor();
    const launch = native.runLaunch;
    native.runLaunch = async spec => {
      const result = await launch(spec);
      if (failed) result.stdout = JSON.stringify({ ...JSON.parse(result.stdout), error: 'execution failed' });
      else {
        const pinned = path.join(run.root, 'native.log');
        fs.writeFileSync(pinned, result.stderr, 'utf8');
        result.stderr = nativeLog('google', result.stdout, result.stderr, { nativeLogPath: pinned });
      }
      return result;
    };
    if (failed) await assert.rejects(completeSyntheticDispatch({ ...run.opts, dispatchId: 'd1' }, native), /error result\/status/);
    else assert.equal((await completeSyntheticDispatch({ ...run.opts, dispatchId: 'd1' }, native)).ok, true);
    assert.equal(inspectRun(run.runDir).outcomes[0].status, failed ? 'FAIL' : 'PASS');
    assert.equal(native.calls(), 1);
  }
});
