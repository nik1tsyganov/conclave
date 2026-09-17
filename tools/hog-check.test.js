// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const node = process.execPath;

function run(p) {
  return spawnSync(node, [path.join(__dirname, 'hog-check.js'), p], { encoding: 'utf8' });
}

describe('hog-check', () => {
  it('passes with three balanced implement vendors', () => {
    const r = run(path.join(__dirname, 'dispatch-log.pass.jsonl'));
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout.trim(), 'FLOOR HOLDS');
  });

  it('fails when one vendor exceeds 60% of implement rows', () => {
    const r = run(path.join(__dirname, 'dispatch-log.fail.jsonl'));
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /FLOOR TRIPPED anthropic/);
  });

  it('rejects anonymous implement rows that would skip uniqueness', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-hog-'));
    const file = path.join(dir, 'anon.jsonl');
    fs.writeFileSync(file, '{"vendor":"openai","role":"implement"}\n{"vendor":"google","role":"implement"}\n{"vendor":"anthropic","role":"implement"}\n');
    const r = run(file);
    fs.rmSync(dir, { recursive: true, force: true });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /IMPLEMENT ROW MISSING IDENTITY/);
  });
});
