'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parseArgs, runDispatch } = require('./dispatch-run.js');

test('dispatch-run parser leaves missing explicit model/effort unset', () => {
  const parsed = parseArgs([
    '--vendor', 'openai', '--role', 'implement', '--class', 'standard-feature', '--brief', 'B.md', '--cwd', 'C:\\src\\repo',
    '--dispatch-id', 'd1', '--unit-id', 'u1', '--evidence-dir', 'out',
  ]);
  assert.strictEqual(parsed.model, undefined);
  assert.strictEqual(parsed.effort, undefined);
});

test('illegal matrix route fails before rules or vendor launch', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-dispatch-run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await assert.rejects(
    runDispatch({
      vendor: 'openai', role: 'implement', class: 'standard-feature', brief: path.join(dir, 'missing-brief.md'), cwd: 'C:\\src\\repo',
      model: 'gpt-6-astra', effort: 'high', dispatchId: 'd1', unitId: 'u1', evidenceDir: path.join(dir, 'out'),
    }),
    (error) => error.code === 'POLICY_FAIL' && /route not in matrix/.test(error.message),
  );
});

test('same-vendor reviewer is rejected before launch', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-dispatch-run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await assert.rejects(
    runDispatch({
      vendor: 'openai', role: 'review', class: 'review-adversarial', brief: path.join(dir, 'missing-brief.md'), cwd: 'C:\\src\\repo',
      model: 'gpt-5.6-sol', effort: 'high', authorVendor: 'openai', dispatchId: 'd2', unitId: 'u2', evidenceDir: path.join(dir, 'out'),
    }),
    (error) => error.code === 'POLICY_FAIL' && /same-vendor review/.test(error.message),
  );
});
