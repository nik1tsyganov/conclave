// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { mkdtempSync, writeFileSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { SCHEMA_PATH, SCHEMA_ID, loadSchema, validateRow, adaptMagiRow } = require('./validate-telemetry.js');

const node = process.execPath;
const helper = path.join(__dirname, 'validate-telemetry.js');
const appendHelper = path.join(__dirname, 'telemetry-append.js');

function run(...args) {
  return spawnSync(node, [helper, ...args], { encoding: 'utf8' });
}

function validRow(overrides = {}) {
  return {
    vendor: 'openai',
    role: 'implement',
    hostMode: 'cursor-cli',
    routedBy: 'arbiter',
    ...overrides,
  };
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'validate-telemetry-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('validate-telemetry', () => {
  it('schema required fields match the Magi append contract', () => {
    const schema = loadSchema();
    assert.strictEqual(schema.$id, 'https://github.com/nik1tsyganov/magi/telemetry/schema.json');
    assert.deepStrictEqual(schema.required, ['vendor', 'role', 'hostMode', 'routedBy']);
    assert.deepStrictEqual(schema.properties.vendor.enum, ['anthropic', 'openai', 'google']);
    assert.strictEqual(schema.properties.routedBy.const, 'arbiter');
    assert.strictEqual(schema.additionalProperties, true);
    assert.ok(readFileSync(SCHEMA_PATH, 'utf8').includes('no join key'));
  });

  it('accepts a row telemetry-append would write', () => {
    const row = validRow({ task: 'preserved extra' });
    const result = validateRow(row, loadSchema());
    assert.deepStrictEqual(result, { ok: true, error: null });

    withTempDir((dir) => {
      const log = path.join(dir, 'dispatches.jsonl');
      const appended = spawnSync(node, [appendHelper, '--row', JSON.stringify(row), '--log', log], { encoding: 'utf8' });
      assert.strictEqual(appended.status, 0, appended.stderr);
      const validated = run('--log', log);
      assert.strictEqual(validated.status, 0, validated.stderr);
      assert.strictEqual(validated.stdout.trim(), 'TELEMETRY VALID 1');
    });
  });

  it('rejects a row missing hostMode and an invented-zero token', () => {
    const noHost = validRow();
    delete noHost.hostMode;
    assert.strictEqual(validateRow(noHost, loadSchema()).error, 'invalid hostMode');

    assert.strictEqual(run('--row', JSON.stringify(noHost)).status, 1);
    assert.strictEqual(run('--row', JSON.stringify(noHost)).stderr.trim(), 'invalid hostMode');

    const zero = run('--row', JSON.stringify(validRow({ totalTokens: 0 })));
    assert.strictEqual(zero.status, 1);
    assert.strictEqual(zero.stderr.trim(), 'invalid totalTokens');
  });

  it('rejects hook capture and invalid calendar dates', () => {
    const captured = run('--row', JSON.stringify(validRow({ capturedBy: 'hook' })));
    const date = run('--row', JSON.stringify(validRow({ date: '2026-02-30' })));
    assert.strictEqual(captured.status, 1);
    assert.strictEqual(captured.stderr.trim(), 'invalid capturedBy');
    assert.strictEqual(date.status, 1);
    assert.strictEqual(date.stderr.trim(), 'invalid date');
  });

  it('adapter envelope names Magi and emits no join key', () => {
    const row = validRow({ vendorSideTokens: null });
    const envelope = adaptMagiRow(row);
    assert.strictEqual(envelope.schemaId, SCHEMA_ID);
    assert.strictEqual(envelope.sourceSystem, 'magi');
    assert.strictEqual(envelope.correlationPolicy, 'none');
    assert.deepStrictEqual(envelope.joinKeys, []);
    assert.deepStrictEqual(envelope.payload, row);
    assert.strictEqual(Object.hasOwn(envelope, 'conclaveId'), false);
    assert.strictEqual(Object.hasOwn(envelope, 'sessionId'), false);

    const r = run('--adapt', '--row', JSON.stringify(row));
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout), envelope);
  });

  it('reads --file and rejects a missing log with exit 2', () => {
    withTempDir((dir) => {
      const input = path.join(dir, 'row.json');
      writeFileSync(input, JSON.stringify(validRow({ vendor: 'google', role: 'verify' })));
      const ok = run('--file', input);
      assert.strictEqual(ok.status, 0, ok.stderr);
      assert.strictEqual(ok.stdout.trim(), 'TELEMETRY VALID google/verify');

      const missing = run('--log', path.join(dir, 'absent.jsonl'));
      assert.strictEqual(missing.status, 2);
      assert.match(missing.stderr, /^cannot read log:/);
    });
  });
});
