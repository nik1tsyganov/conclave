'use strict';

const assert = require('node:assert');
const test = require('node:test');
const { parseArgs, runDispatch } = require('./dispatch-run.js');

test('dispatch-run requires explicit model and effort', () => {
  const parsed = parseArgs([
    '--vendor', 'openai', '--role', 'implement', '--class', 'standard-feature', '--brief', 'B.md', '--cwd', 'C:\\src\\repo',
    '--dispatch-id', 'd1', '--unit-id', 'u1', '--evidence-dir', 'out',
  ]);
  assert.strictEqual(parsed.model, undefined);
  assert.strictEqual(parsed.effort, undefined);
});

test('illegal matrix route fails before rules or vendor launch', async () => {
  await assert.rejects(
    runDispatch({
      vendor: 'openai', role: 'implement', class: 'standard-feature', brief: 'missing-brief.md', cwd: 'C:\\src\\repo',
      model: 'gpt-6-astra', effort: 'high', dispatchId: 'd1', unitId: 'u1', evidenceDir: 'out-test',
    }),
    (error) => error.code === 'POLICY_FAIL' && /route not in matrix/.test(error.message),
  );
});

test('same-vendor reviewer is rejected before launch', async () => {
  await assert.rejects(
    runDispatch({
      vendor: 'openai', role: 'review', class: 'review-adversarial', brief: 'missing-brief.md', cwd: 'C:\\src\\repo',
      model: 'gpt-5.6-sol', effort: 'high', authorVendor: 'openai', dispatchId: 'd2', unitId: 'u2', evidenceDir: 'out-test-2',
    }),
    (error) => error.code === 'POLICY_FAIL' && /same-vendor review/.test(error.message),
  );
});
