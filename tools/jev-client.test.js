// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { systemOne, ENDPOINT, sha256 } = require('./jev-client.js');

const FAKE_KEY = 'sk-test-not-a-real-key';
const ANSWERS = { model: 'jev-1.13.0', answers: { q: { noul: 0.91 } }, usage: { input_tokens: 12, output_tokens: 3 } };

function fakeFetch(statuses, log = []) {
  let call = 0;
  return async (url, init) => {
    log.push({ url, init });
    const status = statuses[Math.min(call, statuses.length - 1)];
    call += 1;
    return { status, text: async () => (status === 200 ? JSON.stringify(ANSWERS) : `{"error":"status ${status}"}`) };
  };
}

const QUESTIONS = { q: { type: 'noul', instructions: 'Is it urgent?' } };

describe('jev-client', () => {
  let saved;
  let dir;
  beforeEach(() => { saved = process.env.TYPESAFE_API_KEY; dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-client-')); });
  afterEach(() => {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('missing key returns NOT_RUN without calling fetch or writing provenance', async () => {
    delete process.env.TYPESAFE_API_KEY;
    const log = [];
    const provenancePath = path.join(dir, 'p.jsonl');
    const result = await systemOne({ state: 's', questions: QUESTIONS, provenancePath, fetchImpl: fakeFetch([200], log) });
    assert.deepStrictEqual(result, { ok: false, notRun: 'TYPESAFE_API_KEY not set', answers: {}, usage: null });
    assert.strictEqual(log.length, 0);
    assert.ok(!fs.existsSync(provenancePath));
  });

  it('parses answers and usage, writes a provenance row without the key', async () => {
    process.env.TYPESAFE_API_KEY = FAKE_KEY;
    const log = [];
    const provenancePath = path.join(dir, 'p.jsonl');
    const result = await systemOne({ state: { a: 1 }, questions: QUESTIONS, provenancePath, fetchImpl: fakeFetch([200], log) });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.answers.q.noul, 0.91);
    assert.deepStrictEqual(result.usage, { input_tokens: 12, output_tokens: 3 });
    assert.strictEqual(result.model, 'jev-1.13.0');

    assert.strictEqual(log[0].url, ENDPOINT);
    assert.strictEqual(log[0].init.method, 'POST');
    assert.strictEqual(log[0].init.headers.Authorization, `Bearer ${FAKE_KEY}`);
    const body = JSON.parse(log[0].init.body);
    assert.deepStrictEqual(body, { state: { a: 1 }, model: 'jev-latest', questions: QUESTIONS });

    const raw = fs.readFileSync(provenancePath, 'utf8');
    assert.ok(!raw.includes(FAKE_KEY));
    const rows = raw.trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].requestSha256, sha256(log[0].init.body));
    assert.strictEqual(rows[0].responseSha256, sha256(JSON.stringify(ANSWERS)));
    assert.strictEqual(rows[0].model, 'jev-1.13.0');
    assert.strictEqual(rows[0].status, 200);
    assert.strictEqual(rows[0].questionCount, 1);
    assert.deepStrictEqual(rows[0].usage, ANSWERS.usage);
    assert.ok(!Number.isNaN(Date.parse(rows[0].ts)));
  });

  it('retries 429 with backoff and succeeds', async () => {
    process.env.TYPESAFE_API_KEY = FAKE_KEY;
    const log = [];
    const sleeps = [];
    const result = await systemOne({ state: 's', questions: QUESTIONS, fetchImpl: fakeFetch([429, 200], log), sleep: async (ms) => sleeps.push(ms) });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(log.length, 2);
    assert.deepStrictEqual(sleeps, [500]);
  });

  it('gives up after three 529s with a NOT_RUN reason', async () => {
    process.env.TYPESAFE_API_KEY = FAKE_KEY;
    const log = [];
    const sleeps = [];
    const provenancePath = path.join(dir, 'p.jsonl');
    const result = await systemOne({ state: 's', questions: QUESTIONS, provenancePath, fetchImpl: fakeFetch([529], log), sleep: async (ms) => sleeps.push(ms) });
    assert.strictEqual(result.ok, false);
    assert.match(result.notRun, /^HTTP 529/);
    assert.strictEqual(log.length, 3);
    assert.deepStrictEqual(sleeps, [500, 1000]);
    const row = JSON.parse(fs.readFileSync(provenancePath, 'utf8').trim());
    assert.strictEqual(row.status, 529);
    assert.ok(!fs.readFileSync(provenancePath, 'utf8').includes(FAKE_KEY));
  });

  it('does not retry a 401 and reports it', async () => {
    process.env.TYPESAFE_API_KEY = FAKE_KEY;
    const log = [];
    const result = await systemOne({ state: 's', questions: QUESTIONS, fetchImpl: fakeFetch([401], log) });
    assert.strictEqual(result.ok, false);
    assert.match(result.notRun, /^HTTP 401/);
    assert.strictEqual(log.length, 1);
  });

  it('network failure returns NOT_RUN instead of throwing', async () => {
    process.env.TYPESAFE_API_KEY = FAKE_KEY;
    const result = await systemOne({ state: 's', questions: QUESTIONS, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
    assert.deepStrictEqual(result, { ok: false, notRun: 'network: ECONNRESET', answers: {}, usage: null });
  });
});
