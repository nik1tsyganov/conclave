'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { load, record } = require('./model-availability.js');
const { probeRecord, temporary } = require('./test-fixtures.js');
const { writeJson } = require('./dispatch-evidence.js');

test('availability replays native evidence and retains the original probe time', (t) => {
  const root = temporary(t); const file = path.join(root, 'availability.json');
  const proof = probeRecord(root, 'openai', 'gpt-6-astra', 'high');
  const first = record({ file, probe: proof.evidence.path });
  const second = record({ file, probe: proof.evidence.path });
  assert.equal(first.observedAt, proof.observedAt); assert.equal(second.observedAt, first.observedAt);
  assert.equal(load(file).vendors.openai.models['gpt-6-astra'].efforts.high.observedModel, 'gpt-6-astra');
});

test('missing, stale, substituted and altered evidence cannot establish availability', (t) => {
  const root = temporary(t); const file = path.join(root, 'availability.json');
  assert.throws(() => record({ file, vendor: 'openai', model: 'gpt-6-astra', observedModel: 'gpt-6-astra' }), /handwritten observations/);
  const proof = probeRecord(root, 'openai', 'gpt-6-astra', 'high');
  const native = JSON.parse(fs.readFileSync(proof.evidence.path));
  writeJson(proof.evidence.path, { ...native, observedModel: 'gpt-5.6-sol' });
  assert.throws(() => record({ file, probe: proof.evidence.path }), /identity mismatch/);
  writeJson(proof.evidence.path, { ...native, startedAt: '2020-01-01T00:00:00.000Z', completedAt: '2020-01-01T00:00:01.000Z' });
  assert.throws(() => record({ file, probe: proof.evidence.path }), /stale/);
  writeJson(proof.evidence.path, native); fs.appendFileSync(native.log, 'tamper');
  assert.throws(() => record({ file, probe: proof.evidence.path }), /hash mismatch/);
  assert.equal(fs.existsSync(file), false);
});
