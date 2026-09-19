// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const {
  systemOne,
  ENDPOINT,
  DEFAULT_MODEL,
  PINNED_MODEL,
  RETRY_STATUS,
  MAX_ATTEMPTS,
  redact,
} = require('./jev-client.js');

const CONTRACT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const CONTRACT_DEFAULT_MODEL = 'jev-latest';
const CONTRACT_PINNED_MODEL = 'jev-1.13.0';
const FAKE_KEY = 'sk-test-NOTAREALKEY';

describe('jev contract tests', () => {
  let savedKey;

  beforeEach(() => {
    savedKey = process.env.TYPESAFE_API_KEY;
  });

  afterEach(() => {
    if (savedKey === undefined) {
      delete process.env.TYPESAFE_API_KEY;
    } else {
      process.env.TYPESAFE_API_KEY = savedKey;
    }
  });

  it('contract values: endpoint, default model alias, pinned resolved model', () => {
    assert.strictEqual(ENDPOINT, CONTRACT_ENDPOINT);
    assert.strictEqual(DEFAULT_MODEL, CONTRACT_DEFAULT_MODEL);
    assert.strictEqual(PINNED_MODEL, CONTRACT_PINNED_MODEL);
  });

  it('redact removes fake key and rewrites Bearer tokens', () => {
    process.env.TYPESAFE_API_KEY = FAKE_KEY;
    const withKey = `request failed: rejected ${FAKE_KEY} at gateway`;
    const redactedKey = redact(withKey);
    assert.ok(!redactedKey.includes(FAKE_KEY));
    assert.strictEqual(redactedKey, 'request failed: rejected [redacted] at gateway');

    const withBearer = 'Authorization: Bearer my-arbitrary-token-here';
    const redactedBearer = redact(withBearer);
    assert.ok(!redactedBearer.includes('my-arbitrary-token-here'));
    assert.strictEqual(redactedBearer, 'Authorization: Bearer [redacted]');
  });

  it('redaction is applied when network fetch throws with key in error message', async () => {
    process.env.TYPESAFE_API_KEY = FAKE_KEY;
    const throwingFetch = async () => {
      throw new Error(`ECONNRESET while using ${FAKE_KEY} with Bearer token-leak`);
    };

    const result = await systemOne({
      state: 'state',
      questions: { q: { type: 'noul', instructions: 'test question' } },
      fetchImpl: throwingFetch,
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.notRun, 'result must have a notRun reason');
    assert.ok(!result.notRun.includes(FAKE_KEY), 'notRun must not contain API key');
    assert.ok(!result.notRun.includes('token-leak'), 'notRun must not contain Bearer token');
    assert.match(result.notRun, /^network: /);
  });

  it('redaction is applied when HTTP 500 error body contains key', async () => {
    process.env.TYPESAFE_API_KEY = FAKE_KEY;
    const errorFetch = async () => ({
      status: 500,
      text: async () => `Internal server error: ${FAKE_KEY} Bearer token-leak`,
    });

    const result = await systemOne({
      state: 'state',
      questions: { q: { type: 'noul', instructions: 'test question' } },
      fetchImpl: errorFetch,
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.notRun, 'result must have a notRun reason');
    assert.ok(!result.notRun.includes(FAKE_KEY), 'notRun must not contain API key');
    assert.ok(!result.notRun.includes('token-leak'), 'notRun must not contain Bearer token');
    assert.match(result.notRun, /^HTTP 500: /);
  });

  // This test's job is to force a conversation, not to forbid a change.
  // Any intentional divergence in retry policy between clients must be
  // recorded in the contract rather than letting it drift silently.
  it('declared differences from sdk client: RETRY_STATUS and MAX_ATTEMPTS', () => {
    assert.strictEqual(MAX_ATTEMPTS, 3);
    assert.ok(RETRY_STATUS.has(429));
    assert.ok(RETRY_STATUS.has(529));
    assert.strictEqual(RETRY_STATUS.size, 2);
  });

  it('warns to stderr on resolved model mismatch without throwing or changing return value', async () => {
    process.env.TYPESAFE_API_KEY = FAKE_KEY;
    const stderrChunks = [];
    const origWrite = process.stderr.write;
    process.stderr.write = (chunk) => {
      stderrChunks.push(String(chunk));
      return true;
    };
    try {
      const mismatchedFetch = async () => ({
        status: 200,
        text: async () => JSON.stringify({
          model: 'jev-1.14.0',
          answers: { q: { noul: 0.8 } },
        }),
      });

      const result = await systemOne({
        state: 'state',
        questions: { q: { type: 'noul', instructions: 'test question' } },
        fetchImpl: mismatchedFetch,
      });

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.model, 'jev-1.14.0');
      const warningText = stderrChunks.join('');
      assert.ok(warningText.includes('jev-1.14.0'), 'warning must name resolved model');
      assert.ok(warningText.includes(PINNED_MODEL), 'warning must name pinned model');
      assert.match(warningText, /re-measured/, 'warning must mention gates re-measurement');
    } finally {
      process.stderr.write = origWrite;
    }
  });
});
