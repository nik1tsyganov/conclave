'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  unlinkSync,
  existsSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { inspectBrief, pointerText } = require('./cli-pointer.js');
const { buildTaskPrompt, assertTaskPrompt } = require('./task-delivery.js');
const { sha256Utf8File } = require('./utf8-hash.js');
const {
  SCHEMA_ID,
  ReceiptError,
  buildReceipt,
  validateReceipt,
  writeReceipt,
  acknowledgeReceipt,
} = require('./receipt-ack.js');

const node = process.execPath;
const helper = path.join(__dirname, 'receipt-ack.js');
const ROOT = path.resolve(__dirname, '..');

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(ROOT, 'temp-receipt-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withBusRoot(busRoot, fn) {
  const previous = process.env.MAGI_BUS_ROOT;
  process.env.MAGI_BUS_ROOT = busRoot;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.MAGI_BUS_ROOT;
    else process.env.MAGI_BUS_ROOT = previous;
  }
}

function run(args, env) {
  return spawnSync(node, [helper, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
}

describe('receipt-ack', () => {
  it('builds a receipt.v1 ACK for hostMode cursor and cursor-cli', () => {
    withTempDir((dir) => {
      const briefPath = path.join(dir, 'brief.md');
      const body = 'FIRST-LINE-ECHO-MARKER\nsecond line\n';
      writeFileSync(briefPath, body);
      const expectedHash = sha256(body);
      const ts = '2026-09-04T08:00:00.000Z';

      for (const hostMode of ['cursor', 'cursor-cli']) {
        const receipt = buildReceipt({
          dispatchId: `fix-comms-${hostMode}`,
          seat: 'balthasar-2',
          briefPath,
          firstLineEcho: 'FIRST-LINE-ECHO-MARKER',
          ts,
          hostMode,
        });
        assert.strictEqual(receipt.schema, SCHEMA_ID);
        assert.strictEqual(receipt.dispatchId, `fix-comms-${hostMode}`);
        assert.strictEqual(receipt.seat, 'balthasar-2');
        assert.strictEqual(receipt.briefPath, path.resolve(briefPath));
        assert.strictEqual(receipt.briefSha256, expectedHash);
        assert.strictEqual(receipt.firstLineEcho, 'FIRST-LINE-ECHO-MARKER');
        assert.strictEqual(receipt.ts, ts);
        assert.strictEqual(Object.hasOwn(receipt, 'conclaveId'), false);
        assert.strictEqual(Object.hasOwn(receipt, 'sessionId'), false);
        assert.strictEqual(Object.hasOwn(receipt, 'joinKeys'), false);
        assert.deepStrictEqual(validateReceipt(receipt), { ok: true, error: null });
      }
    });
  });

  it('acknowledgeReceipt is an explicit disk write, not a Task capture hook', () => {
    withTempDir((dir) => {
      const briefPath = path.join(dir, 'brief.md');
      writeFileSync(briefPath, 'Echo me\nbody');
      const destPath = path.join(dir, 'ack.json');
      const { receipt, receiptPath } = acknowledgeReceipt({
        dispatchId: 'd-write',
        seat: 'melchior-2',
        briefPath,
        ts: '2026-09-04T08:01:00.000Z',
        hostMode: 'cursor',
      }, destPath);
      assert.strictEqual(receiptPath, path.resolve(destPath));
      assert.ok(existsSync(receiptPath));
      assert.deepStrictEqual(JSON.parse(readFileSync(receiptPath, 'utf8')), receipt);
      assert.strictEqual(writeReceipt(receipt, destPath), receiptPath);
    });
    const ack = require('./receipt-ack.js');
    assert.strictEqual(Object.hasOwn(ack, 'capture'), false);
    assert.strictEqual(Object.hasOwn(ack, 'captureTask'), false);
    assert.strictEqual(typeof ack.acknowledgeReceipt, 'function');
    const src = readFileSync(path.join(__dirname, 'receipt-ack.js'), 'utf8');
    assert.match(src, /no Task capture/);
    assert.match(src, /explicit disk/);
    assert.doesNotMatch(src, /function captureTask/);
    const host = readFileSync(path.join(ROOT, '.cursor/skills/magi/references/cursor-host.md'), 'utf8');
    assert.match(host, /should `acknowledgeReceipt`/);
    const arbiterRule = readFileSync(path.join(ROOT, '.cursor/rules/magi-arbiter.mdc'), 'utf8');
    assert.doesNotMatch(arbiterRule, /acknowledgeReceipt/);
  });

  it('rejects a mismatched first-line echo, empty brief, and invented join keys', () => {
    withTempDir((dir) => {
      const briefPath = path.join(dir, 'brief.md');
      writeFileSync(briefPath, 'real-first-line\n');
      assert.throws(() => {
        buildReceipt({
          dispatchId: 'd1',
          seat: 'casper-2',
          briefPath,
          firstLineEcho: 'wrong-line',
        });
      }, /firstLineEcho does not match brief first line/);

      const emptyPath = path.join(dir, 'empty.md');
      writeFileSync(emptyPath, '');
      assert.throws(() => {
        buildReceipt({ dispatchId: 'd1', seat: 'casper-2', briefPath: emptyPath });
      }, /empty/);

      assert.throws(() => {
        buildReceipt({
          dispatchId: 'd1',
          seat: 'casper-2',
          briefPath,
          conclaveId: 'forged',
        });
      }, /do not invent Conclave join key/);
    });
  });

  it('jails brief and receipt paths to the repo or MAGI_BUS_ROOT', () => {
    const bus = mkdtempSync(path.join(tmpdir(), 'magi-receipt-bus-'));
    const outsider = mkdtempSync(path.join(tmpdir(), 'magi-receipt-out-'));
    try {
      withBusRoot(bus, () => {
        const busBrief = path.join(bus, 'bus-brief.md');
        writeFileSync(busBrief, 'bus-first\n');
        const receipt = buildReceipt({
          dispatchId: 'bus-1',
          seat: 'implementer',
          briefPath: busBrief,
          firstLineEcho: 'bus-first',
          ts: '2026-09-04T08:02:00.000Z',
          hostMode: 'cursor-cli',
        });
        assert.strictEqual(receipt.briefPath, path.resolve(busBrief));
        assert.ok(receipt.briefSha256.length === 64);

        writeFileSync(path.join(outsider, 'evil.md'), 'nope\n');
        assert.throws(() => {
          buildReceipt({
            dispatchId: 'evil',
            seat: 'implementer',
            briefPath: path.join(outsider, 'evil.md'),
          });
        }, /outside the pointer zones/);

        assert.throws(() => {
          buildReceipt({
            dispatchId: 'prefix',
            seat: 'implementer',
            briefPath: `${bus}-evil${path.sep}brief.md`,
          });
        }, /outside the pointer zones/);

        const repoReceipt = buildReceipt({
          dispatchId: 'repo-1',
          seat: 'implementer',
          briefPath: busBrief,
          ts: '2026-09-04T08:03:00.000Z',
        });
        assert.throws(() => {
          writeReceipt(repoReceipt, path.join(outsider, 'ack.json'));
        }, /outside the pointer zones/);
      });
    } finally {
      rmSync(bus, { recursive: true, force: true });
      rmSync(outsider, { recursive: true, force: true });
    }
  });

  it('CLI writes and validates a receipt without leaking the brief body', () => {
    withTempDir((dir) => {
      const briefPath = path.join(dir, 'brief.md');
      const outPath = path.join(dir, 'ack.json');
      const body = 'CLI-FIRST-LINE\nsecret-brief-body-should-not-appear-in-receipt\n';
      writeFileSync(briefPath, body);
      const built = run([
        '--dispatch-id', 'cli-1',
        '--seat', 'verifier',
        '--brief', briefPath,
        '--echo', 'CLI-FIRST-LINE',
        '--out', outPath,
        '--host-mode', 'cursor',
      ]);
      assert.strictEqual(built.status, 0, built.stderr);
      assert.match(built.stdout, /RECEIPT ACK cli-1\/verifier/);
      const written = JSON.parse(readFileSync(outPath, 'utf8'));
      assert.strictEqual(written.firstLineEcho, 'CLI-FIRST-LINE');
      assert.ok(!JSON.stringify(written).includes('secret-brief-body-should-not-appear-in-receipt'));

      const validated = run(['--validate', '--file', outPath]);
      assert.strictEqual(validated.status, 0, validated.stderr);
      assert.strictEqual(validated.stdout.trim(), 'RECEIPT VALID cli-1/verifier');

      const badEcho = run([
        '--dispatch-id', 'cli-2',
        '--seat', 'verifier',
        '--brief', briefPath,
        '--echo', 'NOPE',
      ]);
      assert.strictEqual(badEcho.status, 1);
      assert.match(badEcho.stderr, /firstLineEcho does not match brief first line/);
    });
  });

  it('does not change cli-pointer or task-delivery contracts', () => {
    const briefPath = path.join(ROOT, 'temp-receipt-pointer-contract.md');
    const body = 'POINTER-CONTRACT-FIRST\n' + 'z'.repeat(200);
    writeFileSync(briefPath, body);
    try {
      const info = inspectBrief(briefPath);
      assert.strictEqual(info.firstLine, 'POINTER-CONTRACT-FIRST');
      const text = pointerText(info);
      assert.ok(text.startsWith('Read '));
      assert.ok(!text.includes(body));
      const task = buildTaskPrompt(briefPath);
      assert.ok(task.prompt.length <= 2000);
      assert.doesNotThrow(() => assertTaskPrompt(task.prompt, body, briefPath));
      const receipt = buildReceipt({
        dispatchId: 'pointer-contract',
        seat: 'reviewer',
        briefPath,
        firstLineEcho: info.firstLine,
        ts: '2026-09-04T08:04:00.000Z',
        hostMode: 'cursor',
      });
      assert.strictEqual(receipt.briefSha256, sha256Utf8File(briefPath));
      assert.strictEqual(receipt.briefSha256, info.sha256);
      assert.strictEqual(receipt.firstLineEcho, info.firstLine);
    } finally {
      if (existsSync(briefPath)) unlinkSync(briefPath);
    }
  });

  it('strips CR from firstLineEcho the way Conclave inspectBrief splits /\\r?\\n/', () => {
    withTempDir((dir) => {
      const briefPath = path.join(dir, 'crlf.md');
      writeFileSync(briefPath, 'CRLF-FIRST\r\nsecond\n', 'utf8');
      const pointer = inspectBrief(briefPath);
      assert.strictEqual(pointer.firstLine, 'CRLF-FIRST\r');
      const receipt = buildReceipt({
        dispatchId: 'crlf-1',
        seat: 'implementer',
        briefPath,
        firstLineEcho: pointer.firstLine,
        ts: '2026-09-04T08:06:00.000Z',
      });
      assert.strictEqual(receipt.firstLineEcho, 'CRLF-FIRST');
    });
  });

  it('hashes invalid UTF-8 as decoded text, not the raw pointer buffer', () => {
    withTempDir((dir) => {
      const briefPath = path.join(dir, 'invalid.md');
      writeFileSync(briefPath, Buffer.from([0x46, 0x49, 0x52, 0x53, 0x54, 0x0a, 0xff]));
      const pointer = inspectBrief(briefPath);
      const receipt = buildReceipt({
        dispatchId: 'utf8-div',
        seat: 'reviewer',
        briefPath,
        firstLineEcho: pointer.firstLine,
        ts: '2026-09-04T08:04:30.000Z',
      });
      assert.strictEqual(receipt.briefSha256, sha256Utf8File(briefPath));
      assert.notStrictEqual(receipt.briefSha256, pointer.sha256);
    });
  });

  it('validateReceipt rejects a stale hash after the brief changes', () => {
    withTempDir((dir) => {
      const briefPath = path.join(dir, 'brief.md');
      writeFileSync(briefPath, 'v1-first\n');
      const receipt = buildReceipt({
        dispatchId: 'stale',
        seat: 'reviewer',
        briefPath,
        ts: '2026-09-04T08:05:00.000Z',
      });
      writeFileSync(briefPath, 'v2-first\n');
      assert.throws(() => validateReceipt(receipt), ReceiptError);
    });
  });
});
