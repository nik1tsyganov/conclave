'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkSeatOutput, table } = require('./jev-check.js');

const SOURCE = 'function sum(list) {\n  return list.reduce((a, b) => a + b, 0);\n}\nmodule.exports = { sum };\n';

function fake(nouls, log = []) {
  return { log, systemOne: async (req) => { log.push(req); const answers = {}; for (const id of Object.keys(req.questions)) answers[id] = { noul: nouls[id] }; return { ok: true, answers, usage: { input_tokens: 5, output_tokens: 2 } }; } };
}
const NOT_RUN = async () => ({ ok: false, notRun: 'TYPESAFE_API_KEY not set', answers: {}, usage: null });

describe('jev-check', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-check-')); fs.writeFileSync(path.join(dir, 'sum.js'), SOURCE); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('discards claims that fail deterministic pre-checks before Jev sees them', async () => {
    const f = fake({ support_0: 0.9, addresses_0: 0.9 });
    const report = await checkSeatOutput({ claims: [
      { text: 'sum reduces with a 0 seed', evidencePath: path.join(dir, 'sum.js'), quote: 'a + b, 0' },
      { text: 'quote not there', evidencePath: path.join(dir, 'sum.js'), quote: 'a * b' },
      { text: 'file not there', evidencePath: path.join(dir, 'nope.js'), quote: 'x' },
      { text: 'no quote', evidencePath: path.join(dir, 'sum.js'), quote: '' },
    ], systemOne: f.systemOne });
    assert.strictEqual(f.log.length, 1);
    assert.deepStrictEqual(Object.keys(f.log[0].questions).sort(), ['addresses_0', 'support_0']);
    assert.strictEqual(f.log[0].state.claims.length, 1);
    assert.ok(f.log[0].state.claims[0].evidence.includes('a + b, 0'));
    assert.deepStrictEqual(report.claims.map((c) => [c.outcome, c.pass ? 'pass' : c.reason]), [
      ['supported', 'pass'], ['discarded', 'quote not found in evidence'], ['discarded', 'evidence path missing'], ['discarded', 'no quote'],
    ]);
    assert.strictEqual(report.testExitedZero, null);
  });

  it('maps support and addresses nouls onto supported / contradicted / says-nothing', async () => {
    const f = fake({ support_0: 0.8, addresses_0: 0.9, support_1: 0.1, addresses_1: 0.9, support_2: 0.9, addresses_2: 0.2, support_3: 0.5, addresses_3: 0.9 });
    const claim = (text) => ({ text, evidencePath: path.join(dir, 'sum.js'), quote: 'reduce' });
    const report = await checkSeatOutput({ claims: [claim('a'), claim('b'), claim('c'), claim('d')], systemOne: f.systemOne });
    assert.deepStrictEqual(report.claims.map((c) => c.outcome), ['supported', 'contradicted', 'says-nothing', 'says-nothing']);
    assert.deepStrictEqual(report.usage, { input_tokens: 5, output_tokens: 2 });
    const text = table(report);
    assert.match(text, /^0 \| pass \| supported \| 0\.80 \| 0\.90 \| a$/m);
    assert.match(text, /^1 \| pass \| contradicted/m);
  });

  it('reads a receipt: claims resolve against its directory and the recorded test exit code is checked', async () => {
    const receiptPath = path.join(dir, 'receipt.json');
    fs.writeFileSync(receiptPath, JSON.stringify({ claims: [{ text: 'exports sum', evidencePath: 'sum.js', quote: 'module.exports = { sum }' }], test: { command: 'npm test', exitCode: 1 } }));
    const f = fake({ support_0: 0.95, addresses_0: 0.95 });
    const report = await checkSeatOutput({ receiptPath, systemOne: f.systemOne });
    assert.strictEqual(report.testExitedZero, false);
    assert.strictEqual(report.claims[0].outcome, 'supported');
    assert.match(table(report), /test command exited 0: false/);
    fs.writeFileSync(receiptPath, JSON.stringify({ claims: [], test: { command: 'npm test', exitCode: 0 } }));
    const empty = await checkSeatOutput({ receiptPath, systemOne: f.systemOne });
    assert.strictEqual(empty.testExitedZero, true);
    assert.strictEqual(empty.notRun, 'no claims passed pre-checks');
    assert.strictEqual(f.log.length, 1);
  });

  it('without the key the pre-checks still run and every surviving claim is not-run', async () => {
    const report = await checkSeatOutput({ claims: [
      { text: 'a', evidencePath: path.join(dir, 'sum.js'), quote: 'reduce' },
      { text: 'b', evidencePath: path.join(dir, 'sum.js'), quote: 'zzz' },
    ], systemOne: NOT_RUN });
    assert.deepStrictEqual(report.claims.map((c) => c.outcome), ['not-run', 'discarded']);
    assert.strictEqual(report.notRun, 'TYPESAFE_API_KEY not set');
    assert.match(table(report), /jev: NOT_RUN/);
  });
});
