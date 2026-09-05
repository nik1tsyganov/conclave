'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { load, record } = require('./model-availability.js');

test('records exact observed model as available', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-availability-'));
  const file = path.join(dir, 'availability.json');
  const row = record({ file, vendor: 'openai', model: 'gpt-6-astra', observedModel: 'gpt-6-astra', proofId: 'proof-1' });
  assert.strictEqual(row.available, true);
  assert.strictEqual(load(file).vendors.openai.models['gpt-6-astra'].proofId, 'proof-1');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('records substitution as unavailable for requested route', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-availability-'));
  const file = path.join(dir, 'availability.json');
  const row = record({ file, vendor: 'google', model: 'gemini-3.8-flash-high', observedModel: 'gemini-3.8-flash-low', proofId: 'proof-2' });
  assert.strictEqual(row.available, false);
  assert.strictEqual(row.observedModel, 'gemini-3.8-flash-low');
  fs.rmSync(dir, { recursive: true, force: true });
});
