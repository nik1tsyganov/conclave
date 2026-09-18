// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyArbiter, INDEPENDENT, SEATED } = require('./arbiter-policy.js');

const SEATS = [
  { dispatchId: 'impl-1', role: 'implement', vendor: 'openai', model: 'gpt-5.6-sol' },
  { dispatchId: 'ver-1', role: 'verify', vendor: 'anthropic', model: 'opus' },
  { dispatchId: 'rev-1', role: 'review', vendor: 'google', model: 'gemini-3.1-pro-high' },
];
const RECOMMENDED = { vendor: 'jev', model: 'jev-latest' };

test('any vendor may arbitrate, and is recorded as itself', () => {
  for (const [vendor, model] of [['jev', 'jev-latest'], ['xai', 'grok-4.6'], ['deepseek', 'r2'], ['local', 'llama-4-70b']]) {
    const out = classifyArbiter({ vendor, model }, SEATS, RECOMMENDED);
    assert.equal(out.vendor, vendor);
    assert.equal(out.model, model);
    assert.equal(out.independence, INDEPENDENT, `${vendor} holds no seat here`);
    assert.deepEqual(out.sharesVendorWith, []);
  }
});

test('the recommendation is reported, never enforced', () => {
  assert.equal(classifyArbiter(RECOMMENDED, SEATS, RECOMMENDED).matchesRecommendation, true);
  const other = classifyArbiter({ vendor: 'deepseek', model: 'r2' }, SEATS, RECOMMENDED);
  assert.equal(other.matchesRecommendation, false, 'not the recommended arbiter');
  assert.equal(other.independence, INDEPENDENT, 'and refused for nothing, because it holds no seat');
  assert.deepEqual(other.recommended, RECOMMENDED, 'the recommendation still rides along, for the report');
});

// The one arrangement no statistic can repair afterwards.
test('an arbiter that is exactly a seat is refused', () => {
  for (const seat of SEATS) {
    assert.throws(
      () => classifyArbiter({ vendor: seat.vendor, model: seat.model }, SEATS, RECOMMENDED),
      /cannot arbitrate a run it also sits in/,
      `${seat.vendor}/${seat.model} scores its own reply`
    );
  }
});

test('sharing only a vendor is legal, and named', () => {
  const out = classifyArbiter({ vendor: 'anthropic', model: 'fable' }, SEATS, RECOMMENDED);
  assert.equal(out.independence, SEATED);
  assert.deepEqual(out.sharesVendorWith, [{ dispatchId: 'ver-1', role: 'verify', model: 'opus' }]);
  assert.match(out.words, /panel-stats/, 'and the words send the reader to the bias report');
});

test('a run with no seats at all leaves every arbiter independent', () => {
  assert.equal(classifyArbiter({ vendor: 'anthropic', model: 'opus' }, [], RECOMMENDED).independence, INDEPENDENT);
  assert.equal(classifyArbiter({ vendor: 'anthropic', model: 'opus' }).independence, INDEPENDENT, 'seats default to none');
});

test('an arbiter must be declared, and declared completely', () => {
  for (const bad of [undefined, null, 'jev', 42, [], {}, { vendor: 'jev' }, { model: 'jev-latest' }, { vendor: '  ', model: 'x' }]) {
    assert.throws(() => classifyArbiter(bad, SEATS, RECOMMENDED), /arbiter/, `${JSON.stringify(bad)} is not an arbiter`);
  }
});

test('whitespace cannot smuggle a seat past the identity check', () => {
  assert.throws(() => classifyArbiter({ vendor: ' openai ', model: ' gpt-5.6-sol ' }, SEATS, RECOMMENDED),
    /cannot arbitrate a run it also sits in/);
});
