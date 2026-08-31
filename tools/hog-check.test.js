'use strict';

const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const assert = require('node:assert');
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
});
