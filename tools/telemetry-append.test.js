'use strict';

const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');

const helper = path.join(__dirname, 'telemetry-append.js');
const activationCheck = path.join(__dirname, 'activation-check.js');

function run(...args) {
  return spawnSync(process.execPath, [helper, ...args], { encoding: 'utf8' });
}

function runActivation(log) {
  return spawnSync(process.execPath, [activationCheck, log], { encoding: 'utf8' });
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
  const dir = mkdtempSync(path.join(tmpdir(), 'telemetry-append-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('telemetry-append', () => {
  it('creates the telemetry directory and appends one JSON line', () => {
    withTempDir((dir) => {
      const log = path.join(dir, 'telemetry', 'dispatches.jsonl');
      const row = validRow({ task: 'append helper', extra: 'preserved' });

      const r = run('--row', JSON.stringify(row), '--log', log);

      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(r.stdout.trim(), `appended openai/implement ${log}`);
      assert.strictEqual(readFileSync(log, 'utf8'), `${JSON.stringify(row)}\n`);
    });
  });

  it('defaults to the repository telemetry path', () => {
    withTempDir((dir) => {
      const toolsDir = path.join(dir, 'tools');
      const copiedHelper = path.join(toolsDir, 'telemetry-append.js');
      const expectedLog = path.join(dir, 'telemetry', 'dispatches.jsonl');
      mkdirSync(toolsDir);
      copyFileSync(helper, copiedHelper);

      const r = spawnSync(
        process.execPath,
        [copiedHelper, '--row', JSON.stringify(validRow())],
        { cwd: dir, encoding: 'utf8' },
      );

      assert.strictEqual(r.status, 0, r.stderr);
      assert.strictEqual(r.stdout.trim(), `appended openai/implement ${expectedLog}`);
      assert.deepStrictEqual(JSON.parse(readFileSync(expectedLog, 'utf8')), validRow());
    });
  });

  it('reads one JSON object from --file', () => {
    withTempDir((dir) => {
      const input = path.join(dir, 'row.json');
      const log = path.join(dir, 'dispatches.jsonl');
      const row = validRow({ vendor: 'google', role: 'verify' });
      writeFileSync(input, JSON.stringify(row));

      const r = run('--file', input, '--log', log);

      assert.strictEqual(r.status, 0, r.stderr);
      assert.deepStrictEqual(JSON.parse(readFileSync(log, 'utf8')), row);
    });
  });

  it('rejects a row with no hostMode', () => {
    const row = validRow();
    delete row.hostMode;

    const r = run('--row', JSON.stringify(row));

    assert.strictEqual(r.status, 1);
    assert.strictEqual(r.stderr.trim(), 'invalid hostMode');
  });

  it('rejects routedBy values other than arbiter', () => {
    const r = run('--row', JSON.stringify(validRow({ routedBy: 'lead' })));

    assert.strictEqual(r.status, 1);
    assert.strictEqual(r.stderr.trim(), 'invalid routedBy');
  });

  it('rejects codex as the vendor vocabulary', () => {
    const r = run('--row', JSON.stringify(validRow({ vendor: 'codex' })));

    assert.strictEqual(r.status, 1);
    assert.strictEqual(r.stderr.trim(), 'invalid vendor');
  });

  it('does not invent zero token values when telemetry is absent or null', () => {
    withTempDir((dir) => {
      const log = path.join(dir, 'dispatches.jsonl');
      const absent = validRow({ dispatchId: 'absent' });
      const nulls = validRow({
        dispatchId: 'null',
        vendorSideTokens: null,
        totalTokens: null,
      });

      assert.strictEqual(run('--row', JSON.stringify(absent), '--log', log).status, 0);
      assert.strictEqual(run('--row', JSON.stringify(nulls), '--log', log).status, 0);

      const [first, second] = readFileSync(log, 'utf8')
        .trimEnd()
        .split('\n')
        .map(JSON.parse);
      assert.strictEqual(Object.hasOwn(first, 'vendorSideTokens'), false);
      assert.strictEqual(Object.hasOwn(first, 'totalTokens'), false);
      assert.strictEqual(second.vendorSideTokens, null);
      assert.strictEqual(second.totalTokens, null);
    });
  });

  it('rejects zero token values instead of treating missing telemetry as measured zero', () => {
    for (const field of ['vendorSideTokens', 'totalTokens']) {
      const r = run('--row', JSON.stringify(validRow({ [field]: 0 })));
      assert.strictEqual(r.status, 1);
      assert.strictEqual(r.stderr.trim(), `invalid ${field}`);
    }
  });

  it('rejects hook capture and invalid calendar dates', () => {
    const captured = run('--row', JSON.stringify(validRow({ capturedBy: 'hook' })));
    const date = run('--row', JSON.stringify(validRow({ date: '2026-02-30' })));

    assert.strictEqual(captured.status, 1);
    assert.strictEqual(captured.stderr.trim(), 'invalid capturedBy');
    assert.strictEqual(date.status, 1);
    assert.strictEqual(date.stderr.trim(), 'invalid date');
  });

  it('exits 2 when the log cannot be written', () => {
    withTempDir((dir) => {
      const blocker = path.join(dir, 'not-a-directory');
      writeFileSync(blocker, 'block');

      const r = run(
        '--row',
        JSON.stringify(validRow()),
        '--log',
        path.join(blocker, 'dispatches.jsonl'),
      );

      assert.strictEqual(r.status, 2);
      assert.match(r.stderr.trim(), /^cannot write log:/);
    });
  });

  it('writes rows accepted by the activation gate', () => {
    withTempDir((dir) => {
      const log = path.join(dir, 'dispatches.jsonl');
      for (const vendor of ['openai', 'google', 'anthropic']) {
        const r = run('--row', JSON.stringify(validRow({ vendor })), '--log', log);
        assert.strictEqual(r.status, 0, r.stderr);
      }

      const activation = runActivation(log);
      assert.strictEqual(activation.status, 0, activation.stderr);
      assert.strictEqual(activation.stdout.trim(), 'FLOOR HOLDS');
    });
  });
});
