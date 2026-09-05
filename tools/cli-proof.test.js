'use strict';

const assert = require('node:assert');
const test = require('node:test');
const { parseClaude, parseCodex, parseGoogle } = require('./cli-proof.js');

test('Codex proof captures observed model, sandbox, session and tokens', () => {
  const proof = parseCodex(`--------\nsession id: abc\nmodel: gpt-5.6-terra\nsandbox: workspace-write\n--------\ntokens used\n1,234\n`, 'gpt-5.6-terra');
  assert.strictEqual(proof.modelObserved, 'gpt-5.6-terra');
  assert.strictEqual(proof.sessionId, 'abc');
  assert.strictEqual(proof.vendorSideTokens, 1234);
  assert.strictEqual(proof.sandbox, 'workspace-write');
});

test('Google proof rejects silent model substitution', () => {
  const capture = JSON.stringify({ status: 'SUCCESS', conversation_id: 'c1', usage: { input: 1 }, response: 'ok' });
  assert.throws(
    () => parseGoogle(capture, 'Print mode: starting (model="gemini-3.8-flash-low")', 'gemini-3.1-pro-high'),
    /model mismatch/,
  );
});

test('Claude proof does not pretend requested identity was observed', () => {
  const proof = parseClaude('A topical answer', 'fable', 'xhigh', true);
  assert.strictEqual(proof.modelRequested, 'fable');
  assert.strictEqual(proof.effortRequested, 'xhigh');
  assert.strictEqual(proof.identityEvidence, 'requested-only');
  assert.strictEqual(proof.modelObserved, undefined);
});

test('Claude proof requires explicit topicality attestation', () => {
  assert.throws(() => parseClaude('A response', 'fable', 'xhigh', false), /topicality/);
});
