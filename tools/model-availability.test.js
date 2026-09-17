// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { load, record } = require('./model-availability.js');
const { probeRecord, temporary } = require('./test-fixtures.js');
const { hashFile, writeJson } = require('./dispatch-evidence.js');

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

for (const target of ['probe', 'capture', 'log', 'path alias', 'directory alias', 'hard link']) {
  test(`availability CLI refuses ${target} output without changing verified evidence`, t => {
    const root = temporary(t);
    const proof = probeRecord(root, 'anthropic', 'opus', 'medium', 'claude-opus-5');
    const probe = proof.evidence.path;
    const native = JSON.parse(fs.readFileSync(probe, 'utf8'));
    let file = { probe, capture: native.capture, log: native.log }[target];
    if (target === 'path alias') {
      file = `${path.dirname(probe)}${path.sep}..${path.sep}${path.basename(path.dirname(probe))}${path.sep}${path.basename(probe)}`;
    }
    if (target === 'directory alias') {
      const alias = path.join(root, 'alias');
      fs.symlinkSync(path.dirname(probe), alias, 'dir');
      file = path.join(alias, path.basename(probe));
    }
    if (target === 'hard link') {
      file = path.join(root, 'linked-probe.json');
      fs.linkSync(probe, file);
    }
    const files = [probe, native.capture, native.log, file];
    const before = files.map(hashFile);
    const result = spawnSync(process.execPath, [path.join(__dirname, 'model-availability.js'), '--file', file, '--probe', probe], {
      cwd: root, shell: false, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /overlap|symlink|junction|hard links/);
    assert.deepEqual(files.map(hashFile), before);
  });
}

test('availability CLI preserves probe evidence when it creates and updates a separate output', t => {
  const root = temporary(t);
  const proof = probeRecord(root, 'anthropic', 'opus', 'medium', 'claude-opus-5');
  const probe = proof.evidence.path;
  const native = JSON.parse(fs.readFileSync(probe, 'utf8'));
  const before = [probe, native.capture, native.log].map(hashFile);
  const file = path.join(root, 'new output', 'availability.json');
  for (let i = 0; i < 2; i++) {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'model-availability.js'), '--file', file, '--probe', probe], {
      cwd: root, shell: false, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).evidence.sha256, hashFile(probe));
    assert.equal(load(file).vendors.anthropic.models.opus.efforts.medium.available, true);
    assert.deepEqual([probe, native.capture, native.log].map(hashFile), before);
  }
});
