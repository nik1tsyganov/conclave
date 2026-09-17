// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');

const node = process.execPath;

function run(...args) {
  return spawnSync(node, [path.join(__dirname, 'activation-check.js'), ...args], { encoding: 'utf8' });
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

  it('rejects handwritten balanced rows as uncommitted evidence', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'activation-check-'));
    const liveLog = path.join(dir, 'live.jsonl');
    writeFileSync(liveLog, '{"vendor":"google","role":"implement"}\n{"vendor":"anthropic","role":"implement"}\n{"vendor":"openai","role":"implement"}\n');
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
