// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { completeSyntheticDispatch, createSealedRun, fakeVendor } = require('./test-fixtures.js');

const node = process.execPath;

function run(...args) {
  return spawnSync(node, [path.join(__dirname, 'activation-check.js'), ...args], { encoding: 'utf8' });
}

// A genuinely committed run: sealed panel, every dispatch driven to a committed
// transaction by the injectable fake vendor. Mirrors run-finalize.test.js.
async function completedRun(t) {
  const sealed = createSealedRun(t, [
    { unitId: 'u1' },
    { unitId: 'u1', role: 'verify', class: 'test-verification', vendor: 'anthropic', model: 'opus', effort: 'medium', authorVendor: 'openai' },
    { unitId: 'u1', role: 'review', class: 'review-adversarial', vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high', authorVendor: 'openai' },
  ], { conclaveConvened: true });
  for (const row of sealed.dispatches) await completeSyntheticDispatch({ ...sealed.opts, dispatchId: row.dispatchId }, fakeVendor());
  return sealed;
}

describe('activation-check', () => {
  it('exits 2 when the log file is missing', () => {
    const r = run(path.join(__dirname, 'missing-dispatch-log.jsonl'));
    assert.strictEqual(r.status, 2);
    assert.strictEqual(r.stderr.trim(), 'NO LIVE LOG');
  });

  it('rejects the pass fixture as a fixture log', () => {
    const r = run(path.join(__dirname, 'dispatch-log.pass.jsonl'));
    assert.strictEqual(r.status, 1);
    assert.strictEqual(r.stderr.trim(), 'FIXTURE LOG — NOT AN ACTIVATION');
  });

  it('rejects the fail fixture as a fixture log', () => {
    const r = run(path.join(__dirname, 'dispatch-log.fail.jsonl'));
    assert.strictEqual(r.status, 1);
    assert.strictEqual(r.stderr.trim(), 'FIXTURE LOG — NOT AN ACTIVATION');
  });

  it('accepts a valid committed run', async (t) => {
    // Accept-path guard: without a passing input, a product that rejects EVERY input passes this file.
    const sealed = await completedRun(t);
    const r = run(path.join(sealed.runDir, 'conclave-dispatch-log.jsonl'));
    assert.strictEqual(r.status, 0);
    assert.strictEqual(JSON.parse(r.stdout).ok, true);
  });

  it('rejects a committed log with one row stripped of its transaction', async (t) => {
    // Mutation of the passing input: the real committed log, one row broken.
    const sealed = await completedRun(t);
    const rows = readFileSync(path.join(sealed.runDir, 'conclave-dispatch-log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    delete rows[0].transactionPath;
    const dir = mkdtempSync(path.join(tmpdir(), 'activation-check-'));
    const liveLog = path.join(dir, 'live.jsonl');
    writeFileSync(liveLog, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
    try {
      const r = run(liveLog);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /committed dispatch transaction/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects handwritten imbalanced rows before accounting', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'activation-check-'));
    const liveLog = path.join(dir, 'live.jsonl');
    writeFileSync(liveLog, '{"vendor":"anthropic","role":"implement"}\n{"vendor":"anthropic","role":"implement"}\n{"vendor":"anthropic","role":"implement"}\n{"vendor":"openai","role":"implement"}\n');
    try {
      const r = run(liveLog);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /committed dispatch transaction/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
