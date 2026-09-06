'use strict';

const assert = require('node:assert');
const test = require('node:test');
const { parseClaude, parseCodex, parseGoogle, verifyNativeProof, verifyProof, main } = require('./cli-proof.js');
const fs = require('node:fs');

test('Codex proof positive captures observed model, sandbox, session and tokens exactly', () => {
  const log = `2026-09-05T17:35:12.498274Z  WARN codex_skills::interface: ...
OpenAI Codex v1.0
--------
session id: abc
model: gpt-5.6-terra
sandbox: workspace-write
reasoning effort: high
--------
body
tokens used
1,234
`;
  const proof = parseCodex(log, 'gpt-5.6-terra', { expectedSandbox: 'workspace-write', expectedEffort: 'high' });
  assert.strictEqual(proof.modelObserved, 'gpt-5.6-terra');
  assert.strictEqual(proof.sessionId, 'abc');
  assert.strictEqual(proof.vendorSideTokens, 1234);
  assert.strictEqual(proof.sandbox, 'workspace-write');
  assert.strictEqual(proof.effortObserved, 'high');
});

test('Codex proof rejects synthetic body identity', () => {
  const log = `OpenAI Codex v1.0\n--------\nsession id: abc\nsandbox: workspace-write\n--------\nmodel: gpt-9\ntokens used\n1,234\n`;
  assert.throws(() => parseCodex(log, 'gpt-9'), /missing model/);
});

test('Codex proof rejects wrong expected sandbox/effort', () => {
  const log = `OpenAI Codex v1.0\n--------\nsession id: abc\nmodel: gpt-5\nsandbox: workspace-write\nreasoning effort: high\n--------\nbody\ntokens used\n1\n`;
  assert.throws(() => parseCodex(log, 'gpt-5', { expectedSandbox: 'read-only' }), /sandbox mismatch/);
  assert.throws(() => parseCodex(log, 'gpt-5', { expectedEffort: 'low' }), /effort mismatch/);
});

test('Codex tokens phrase inside body is not a footer', () => {
  const log = `OpenAI Codex v1.0\n--------\nsession id: abc\nmodel: gpt-5.6-terra\nsandbox: workspace-write\nreasoning effort: high\n--------\nbody\ntokens used\n1,234\nmore answer text`;
  assert.throws(() => parseCodex(log, 'gpt-5.6-terra'), /missing tokens used/);
});

test('Codex malformed thousands grouping', () => {
  const log = `OpenAI Codex v1.0\n--------\nsession id: abc\nmodel: gpt-5.6-terra\nsandbox: workspace-write\nreasoning effort: high\n--------\nbody\ntokens used\n1234,567\n`;
  assert.throws(() => parseCodex(log, 'gpt-5.6-terra'), /missing tokens used/);
});

test('Codex invalid observed effort', () => {
  const log = `OpenAI Codex v1.0\n--------\nsession id: abc\nmodel: gpt-5\nsandbox: workspace-write\nreasoning effort: banana\n--------\nbody\ntokens used\n123\n`;
  assert.throws(() => parseCodex(log, 'gpt-5'), /invalid effort: banana/);
});

test('Codex arbitrary preamble rejection', () => {
  const log = `Some arbitrary prose\nOpenAI Codex v1.0\n--------\nsession id: abc\nmodel: gpt-5\nsandbox: workspace-write\nreasoning effort: high\n--------\nbody\ntokens used\n123\n`;
  assert.throws(() => parseCodex(log, 'gpt-5'), /must be in the preamble/);
});

test('Google proof positive', () => {
  const capture = JSON.stringify({ status: 'SUCCESS', conversation_id: 'c1', usage: { total_tokens: 10 }, response: 'ok' });
  const log = `I0905 12:24:51.447595       1 printmode.go:173] Print mode: starting (model="gemini-3.1", conversationID="c1")
I0905 12:24:55.788127       1 session.go:171] Print mode: conversation=c1, sending message`;
  const proof = parseGoogle(capture, log, 'gemini-3.1');
  assert.strictEqual(proof.modelObserved, 'gemini-3.1');
  assert.strictEqual(proof.conversationId, 'c1');
});

test('Google SUCCESS cannot override explicit native errors', () => {
  const envelope = { status: 'SUCCESS', conversation_id: 'c1', usage: { total_tokens: 10 }, response: 'The code handles error and is_error fields.' };
  const log = 'I0905 12:24:51.447595       1 printmode.go:173] Print mode: starting (model="gemini-3.1", conversationID="c1")\nI0905 12:24:55.788127       1 session.go:171] Print mode: conversation=c1, sending message';
  for (const fields of [{ is_error: true }, { error: 'execution failed' }, { error: { message: 'execution failed' } }]) {
    assert.throws(() => parseGoogle(JSON.stringify({ ...envelope, ...fields }), log, 'gemini-3.1'), /error result\/status/);
  }
  assert.equal(parseGoogle(JSON.stringify({ ...envelope, is_error: false, error: null }), log, 'gemini-3.1').conversationId, 'c1');
});

test('standalone OpenAI proof requires nonempty capture as well as valid banner proof', t => {
  const path = require('node:path');
  const root = require('./test-fixtures.js').temporary(t);
  const capture = path.join(root, 'capture.txt');
  const log = path.join(root, 'native.log');
  fs.writeFileSync(log, 'OpenAI Codex v1.0\n--------\nsession id: s1\nmodel: gpt-5.6-terra\nsandbox: read-only\nreasoning effort: medium\n--------\ntokens used\n123\n', 'utf8');
  const options = { vendor: 'openai', capture, log, expectedModel: 'gpt-5.6-terra', expectedEffort: 'medium', expectedSandbox: 'read-only' };
  for (const blank of ['', ' \t\r\n', '\uFEFF \n']) {
    fs.writeFileSync(capture, blank, 'utf8');
    assert.throws(() => verifyNativeProof(options), /capture is empty/);
    let error = '';
    assert.equal(main(['--vendor', 'openai', '--capture', capture, '--log', log], { stdout: { write: () => {} }, stderr: { write: value => { error += value; } } }), 1);
    assert.match(error, /PROOF_FAIL.*capture is empty/);
  }
  fs.writeFileSync(capture, 'Task complete.\n', 'utf8');
  assert.equal(verifyNativeProof(options).sessionId, 's1');
});

test('Google proof rejects silent model substitution and agy same-file wrong conversation and unrelated first model', () => {
  const capture = JSON.stringify({ status: 'SUCCESS', conversation_id: 'c2', usage: { total_tokens: 10 }, response: 'ok' });
  const log = `
I0905 12:24:51.447595       1 printmode.go:173] Print mode: starting (model="gemini-wrong", conversationID="")
I0905 12:24:51.447595       1 server.go:173] Created conversation c1
I0905 12:24:51.447595       1 printmode.go:173] Print mode: starting (model="gemini-right", conversationID="")
I0905 12:24:51.447595       1 server.go:173] Created conversation c2
I0905 12:24:51.447595       1 session.go:171] Print mode: conversation=c2, sending message
`;
  const proof = parseGoogle(capture, log, 'gemini-right');
  assert.strictEqual(proof.modelObserved, 'gemini-right');
  assert.throws(() => parseGoogle(capture, log, 'gemini-wrong'), /model mismatch/);
});

test('Google proof ambiguous log', () => {
  const capture = JSON.stringify({ status: 'SUCCESS', conversation_id: 'c1', usage: { total_tokens: 10 }, response: 'ok' });
  const log = `
I0905 12:24:51.447595       1 printmode.go:173] Print mode: starting (model="gemini-1", conversationID="c1")
I0905 12:24:51.447595       1 session.go:173] Print mode: conversation=c1, sending message
I0905 12:24:51.447595       1 printmode.go:173] Print mode: starting (model="gemini-2", conversationID="c1")
I0905 12:24:51.447595       1 session.go:173] Print mode: conversation=c1, sending message
`;
  assert.throws(() => parseGoogle(capture, log, 'gemini-1'), /ambiguous/);
});

test('Google proof malformed usage and whitespace response', () => {
  assert.throws(() => parseGoogle(JSON.stringify({ status: 'SUCCESS', conversation_id: 'c1', usage: [], response: 'ok' }), '', ''), /malformed usage/);
  assert.throws(() => parseGoogle(JSON.stringify({ status: 'SUCCESS', conversation_id: 'c1', usage: { total_tokens: 10 }, response: '   ' }), '', ''), /whitespace response/);
});

test('Claude proof JSON positive exact alias comparison', () => {
  const capture = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 2 }, modelUsage: { 'claude-opus-5': { inputTokens: 1, outputTokens: 2 } } });
  const proof = parseClaude(capture, 'opus', 'high', true, { expectedObservedModel: 'claude-opus-5' });
  assert.strictEqual(proof.modelObserved, 'claude-opus-5');
});

test('Claude proof JSONL', () => {
  const capture = `{"type":"system","subtype":"init","model":"c1","session_id":"s1"}
{"type":"assistant","session_id":"s1","message":{"model":"c1","content":[{"type":"text","text":"ok"}]}}
{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"s1","usage":{"input_tokens":1,"output_tokens":1},"modelUsage":{"c1":{"inputTokens":1,"outputTokens":1}}}`;
  const proof = parseClaude(capture, 'c1', 'high', true);
  assert.strictEqual(proof.modelObserved, 'c1');
});

test('Claude proof inconsistent sessions/models', () => {
  const capture = `{"type":"system","subtype":"init","model":"m1","session_id":"s1"}
{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"s2","usage":{"input_tokens":1,"output_tokens":1},"modelUsage":{"m2":{"inputTokens":1,"outputTokens":1}}}`;
  assert.throws(() => parseClaude(capture, 'm1', 'high', true), /inconsistent sessions/);
});

test('Claude proof denies requested-only evidence and programmatic exceptions', () => {
  assert.throws(() => parseClaude('plain text', 'c1', 'high', true), /requires structured native evidence/);
  assert.throws(() => parseClaude('plain text', 'c1', 'high', true, { identityPolicy: 'allow-requested-only' }), /identity policy overrides are not supported/);
  const missingModel = { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 2 } };
  assert.throws(() => parseClaude(JSON.stringify(missingModel), 'c1', 'high', true), /missing observed model identity/);
});

test('Claude malformed structured data must not become requested-only success', () => {
  assert.throws(() => parseClaude('{"type":"result', 'c1', 'high', true), /malformed structured data/);
});

test('Claude auth diagnostics reject failures without interpreting quoted task data as status', () => {
  const result = { type: 'result', subtype: 'success', is_error: false, result: 'The source checks not logged in and authentication required.', session_id: 's1', usage: { input_tokens: 1, output_tokens: 2 }, modelUsage: { c1: { inputTokens: 1, outputTokens: 2 } } };
  const toolData = { type: 'user', session_id: 's1', message: { content: [{ type: 'tool_result', content: 'please run /login; auth required' }] } };
  assert.equal(parseClaude([toolData, result].map(JSON.stringify).join('\n'), 'c1', 'high', true).modelObserved, 'c1');
  assert.throws(() => parseClaude(JSON.stringify({ ...result, is_error: true, subtype: 'error_during_execution' }), 'c1', 'high', true), /error result\/status/);
  assert.throws(() => parseClaude('Not logged in. Please run /login.', 'c1', 'high', true), /auth failure/);
});

test('Claude user-text/native-metadata distinction', () => {
  const capture = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'I am claude-opus-5', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: { 'claude-5': { inputTokens: 1, outputTokens: 1 } } });
  assert.throws(() => parseClaude(capture, 'claude-opus-5', 'high', true, { expectedObservedModel: 'claude-opus-5' }), /model mismatch/);
});

test('Claude proof requires explicit topicality attestation', () => {
  const capture = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: { 'c1': { inputTokens: 1, outputTokens: 1 } } });
  assert.throws(() => parseClaude(capture, 'c1', 'high', false), /topicality/);
});

test('Claude transcript effort match', () => {
  const capture = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 2 }, modelUsage: { 'c1': { inputTokens: 1, outputTokens: 2 } } });
  const log = `{"type":"assistant","sessionId":"s1","effort":"high","message":{"model":"c1"}}`;
  const proof = parseClaude(capture, 'c1', 'high', true, { logText: log, requireObservedEffort: true });
  assert.strictEqual(proof.effortObserved, 'high');
});

test('Claude transcript missing effort fails', () => {
  const capture = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 2 }, modelUsage: { 'c1': { inputTokens: 1, outputTokens: 2 } } });
  const log = `{"type":"assistant","sessionId":"s1","message":{"model":"c1"}}`;
  assert.throws(() => parseClaude(capture, 'c1', 'high', true, { logText: log, requireObservedEffort: true }), /missing native observed effort/);
});

test('Claude transcript wrong session fails to match effort', () => {
  const capture = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 2 }, modelUsage: { 'c1': { inputTokens: 1, outputTokens: 2 } } });
  const log = `{"type":"assistant","sessionId":"s2","effort":"high","message":{"model":"c1"}}`;
  assert.throws(() => parseClaude(capture, 'c1', 'high', true, { logText: log, requireObservedEffort: true }), /missing native observed effort/);
});

test('Claude verifyProof passes log and requires effort', (t) => {
  const root = require('./test-fixtures.js').temporary(t);
  const cap = require('node:path').join(root, 'capture.json');
  const log = require('node:path').join(root, 'log.jsonl');
  fs.writeFileSync(cap, JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 2 }, modelUsage: { 'c1': { inputTokens: 1, outputTokens: 2 } } }));
  fs.writeFileSync(log, `{"type":"assistant","sessionId":"s1","effort":"high","message":{"model":"c1"}}`);
  const proof = verifyProof({ vendor: 'anthropic', capture: cap, log, expectedModel: 'c1', expectedEffort: 'high', onTopic: true });
  assert.strictEqual(proof.effortObserved, 'high');
});

test('Claude rejects malformed counts, duplicate results, unknown policy and empty terminal text', () => {
  const result = { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 2 }, modelUsage: { c1: { inputTokens: 1, outputTokens: 2 } } };
  const parse = (value, opts) => parseClaude(JSON.stringify(value), 'c1', 'high', true, opts);
  assert.throws(() => parse(result, { identityPolicy: 'anything' }), /identity policy overrides are not supported/);
  for (const count of [-1, 0.5, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => parse({ ...result, usage: { input_tokens: count, output_tokens: 2 } }), /usage/);
  }
  assert.throws(() => parse({ ...result, modelUsage: { c1: { inputTokens: -1, outputTokens: 2 } } }), /modelUsage/);
  const native = JSON.stringify(result);
  assert.throws(() => parseClaude(`${native}\n${native}`, 'c1', 'high', true), /duplicate terminal/);
  const assistant = JSON.stringify({ type: 'assistant', session_id: 's1', message: { model: 'c1', content: [{ type: 'text', text: 'ok' }] } });
  assert.throws(() => parseClaude(`${assistant}\n${JSON.stringify({ ...result, result: '  ' })}`, 'c1', 'high', true), /actual result text/);
});

test('CLI flags cannot enable identity policy exception', () => {
  assert.strictEqual(main(['--identity-policy', 'allow-requested-only'], { stdout: { write: () => {} }, stderr: { write: () => {} } }), 2);
});
