'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadMatrix, routeAllowed, validatePlan } = require('./dispatch-matrix.js');

const matrix = loadMatrix();

function availabilityFor(vendor, model, observedModel = model) {
  return { vendors: { [vendor]: { models: { [model]: { available: observedModel === model, observedModel } } } } };
}

test('Astra is fail-closed until exact local model proof exists', () => {
  const route = { class: 'extreme-end-to-end', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high' };
  assert.deepStrictEqual(routeAllowed(matrix, route, {}).ok, false);
  assert.deepStrictEqual(routeAllowed(matrix, route, availabilityFor('openai', 'gpt-6-astra')).ok, true);
  assert.deepStrictEqual(routeAllowed(matrix, route, availabilityFor('openai', 'gpt-6-astra', 'gpt-5.6-sol')).ok, false);
});

test('Fable alias maps to current 5.1 canonical family in the catalog', () => {
  assert.strictEqual(matrix.vendors.anthropic.models.fable.canonical, 'claude-fable-5-1');
  assert.strictEqual(routeAllowed(matrix, {
    class: 'agentic-long-run', role: 'implement', vendor: 'anthropic', model: 'fable', effort: 'xhigh',
  }).ok, true);
});

test('standard feature rejects frontier over-routing not listed by policy', () => {
  const result = routeAllowed(matrix, {
    class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high',
  }, availabilityFor('openai', 'gpt-6-astra'));
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /route not in matrix/);
});

test('Grok cannot occupy a seat', () => {
  assert.throws(() => validatePlan({
    hostMode: 'cursor-cli',
    arbiter: { vendor: 'xai', model: 'grok-4.6', effort: 'high' },
    magiConvened: false,
    dispatches: [{ unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'xai', model: 'grok-4.6', effort: 'high' }],
  }, matrix), /may not occupy a seat/);
});

test('convened MAGI requires all three implementation vendors', () => {
  assert.throws(() => validatePlan({
    hostMode: 'cursor-cli',
    arbiter: { vendor: 'xai', model: 'grok-4.6', effort: 'high' },
    magiConvened: true,
    dispatches: [
      { unitId: 'u1', class: 'standard-feature', role: 'implement', vendor: 'openai', model: 'gpt-5.6-terra', effort: 'medium' },
      { unitId: 'u2', class: 'standard-feature', role: 'implement', vendor: 'anthropic', model: 'sonnet', effort: 'medium' },
    ],
  }, matrix), /requires 3 implement vendors/);
});

test('same-vendor review of authored work is rejected', () => {
  assert.throws(() => validatePlan({
    hostMode: 'cursor-cli',
    arbiter: { vendor: 'xai', model: 'grok-4.6', effort: 'high' },
    magiConvened: false,
    dispatches: [{
      unitId: 'u1', class: 'review-adversarial', role: 'review', vendor: 'openai', model: 'gpt-5.6-sol', effort: 'high', authorVendor: 'openai',
    }],
  }, matrix), /same-vendor review forbidden/);
});

test('availability loader accepts exact proof record format', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-matrix-'));
  const file = path.join(dir, 'availability.json');
  fs.writeFileSync(file, JSON.stringify(availabilityFor('openai', 'gpt-6-astra')), 'utf8');
  const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(routeAllowed(matrix, {
    class: 'extreme-end-to-end', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high',
  }, loaded).ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
