// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
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
} = require('node:fs');
const { tmpdir } = require('node:os');
const { SCHEMA_PATH, validateRow, loadSchema } = require('./validate-telemetry.js');
const {
  SCHEMA_ID,
  SYSTEMS,
  STATUSES,
  DEFAULT_LOG,
  systemFromHostMode,
  buildHandoff,
  validateHandoff,
  appendHandoff,
  recordHandoff,
} = require('./handoff-envelope.js');
const { firstLineUtf8File, sha256Utf8File } = require('./utf8-hash.js');
const { inspectBrief } = require('./cli-pointer.js');
const { HOST_MODES, isCliHostMode } = require('./dispatch-schema.js');

const node = process.execPath;
const helper = path.join(__dirname, 'handoff-envelope.js');
const ROOT = path.resolve(__dirname, '..');

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(ROOT, 'temp-handoff-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withBusRoot(busRoot, fn) {
  const previous = process.env.CONCLAVE_BUS_ROOT;
  process.env.CONCLAVE_BUS_ROOT = busRoot;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.CONCLAVE_BUS_ROOT;
    else process.env.CONCLAVE_BUS_ROOT = previous;
  }
}

function run(args) {
  return spawnSync(node, [helper, ...args], { encoding: 'utf8' });
}

function seedBrief(dir, name = 'brief.md', body = 'HANDOFF-FIRST\nbody\n') {
  const briefPath = path.join(dir, name);
  writeFileSync(briefPath, body);
  return { briefPath, body, hash: sha256(body) };
}

describe('handoff-envelope', () => {
  it('maps hostMode to conclave / conclave-cli and keeps dispatch schema untouched', () => {
    // Every host, read from the one list. This named three hosts until 2026-09-18 and so
    // never noticed that vscode and droppy reached the unhandled-hostMode throw instead.
    for (const mode of HOST_MODES) {
      assert.strictEqual(systemFromHostMode(mode), isCliHostMode(mode) ? 'conclave-cli' : 'conclave');
    }
    assert.strictEqual(systemFromHostMode('cursor'), 'conclave');
    for (const mode of ['vscode', 'droppy']) {
      assert.strictEqual(systemFromHostMode(mode), 'conclave-cli');
    }
    assert.deepStrictEqual(SYSTEMS, ['conclave', 'conclave-cli']);
    assert.deepStrictEqual(STATUSES, ['accepted', 'blocked', 'done', 'failed']);
    assert.ok(DEFAULT_LOG.endsWith(path.join('telemetry', 'handoffs.jsonl')));

    const schema = loadSchema();
    assert.strictEqual(schema.$id, 'https://github.com/nik1tsyganov/conclave/telemetry/schema.json');
    assert.deepStrictEqual(schema.required, ['vendor', 'role', 'hostMode', 'routedBy']);
    const dispatchRow = {
      vendor: 'openai',
      role: 'implement',
      hostMode: 'cursor',
      routedBy: 'arbiter',
    };
    assert.deepStrictEqual(validateRow(dispatchRow, schema), { ok: true, error: null });
    assert.ok(readFileSync(SCHEMA_PATH, 'utf8').includes('no join key'));
    assert.match(readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /^telemetry\/handoffs\.jsonl$/m);
  });

  it('builds and appends a handoff-envelope.v1 row', () => {
    withTempDir((dir) => {
      const { briefPath, hash } = seedBrief(dir);
      const outputPath = path.join(dir, 'out.md');
      writeFileSync(outputPath, 'artifact\n');
      const ts = '2026-09-04T09:00:00.000Z';
      const envelope = buildHandoff({
        dispatchId: 'h1',
        hostMode: 'cursor',
        seat: 'implementer',
        status: 'done',
        briefPath,
        outputPaths: [outputPath],
        nextOwner: 'reviewer',
        uncertainties: ['need review'],
        doNotAssume: ['merged'],
        ts,
      });
      assert.strictEqual(envelope.schema, SCHEMA_ID);
      assert.strictEqual(envelope.system, 'conclave');
      assert.strictEqual(envelope.briefSha256, hash);
      assert.deepStrictEqual(envelope.outputPaths, [path.resolve(outputPath)]);
      assert.strictEqual(envelope.outputSha256s[path.resolve(outputPath)], sha256('artifact\n'));
      assert.strictEqual(Object.hasOwn(envelope, 'conclaveId'), false);
      assert.strictEqual(Object.hasOwn(envelope, 'joinKeys'), false);
      assert.deepStrictEqual(validateHandoff(envelope), { ok: true, error: null });

      const log = path.join(dir, 'handoffs.jsonl');
      const dest = appendHandoff(envelope, log);
      assert.strictEqual(dest, path.resolve(log));
      assert.strictEqual(readFileSync(log, 'utf8'), `${JSON.stringify(envelope)}\n`);

      const recorded = recordHandoff({
        dispatchId: 'h1-disk',
        hostMode: 'cursor',
        seat: 'implementer',
        status: 'done',
        briefPath,
        outputPaths: [outputPath],
        nextOwner: 'reviewer',
        ts: '2026-09-04T09:00:01.000Z',
      }, log);
      assert.ok(existsSyncSafe(recorded.handoffLog));
      assert.strictEqual(readFileSync(log, 'utf8').trim().split('\n').length, 2);
    });
    const handoff = require('./handoff-envelope.js');
    assert.strictEqual(Object.hasOwn(handoff, 'capture'), false);
    assert.strictEqual(typeof handoff.recordHandoff, 'function');
    const src = readFileSync(path.join(__dirname, 'handoff-envelope.js'), 'utf8');
    assert.match(src, /no Task capture/);
    assert.doesNotMatch(src, /function captureTask/);
  });

  it('accepts conclave-cli system and empty outputs for a blocked handoff', () => {
    withTempDir((dir) => {
      const { briefPath } = seedBrief(dir, 'cli-brief.md', 'CLI-HANDOFF\n');
      const envelope = buildHandoff({
        dispatchId: 'h-cli',
        system: 'conclave-cli',
        seat: 'codex-implementer',
        status: 'blocked',
        briefPath,
        nextOwner: 'arbiter',
        ts: '2026-09-04T09:01:00.000Z',
      });
      assert.strictEqual(envelope.system, 'conclave-cli');
      assert.deepStrictEqual(envelope.outputPaths, []);
      assert.deepStrictEqual(envelope.outputSha256s, {});
      assert.deepStrictEqual(envelope.uncertainties, []);
      assert.deepStrictEqual(envelope.doNotAssume, []);
    });
  });

  it('rejects bad status, hash mismatch, join keys, and jailed outsiders', () => {
    withTempDir((dir) => {
      const { briefPath } = seedBrief(dir);
      assert.throws(() => {
        buildHandoff({
          dispatchId: 'bad-status',
          system: 'conclave',
          seat: 'implementer',
          status: 'shipped',
          briefPath,
          nextOwner: '',
        });
      }, /invalid status/);

      assert.throws(() => {
        buildHandoff({
          dispatchId: 'join',
          system: 'conclave',
          seat: 'implementer',
          status: 'accepted',
          briefPath,
          nextOwner: '',
          sessionId: 'forged',
        });
      }, /do not invent Conclave join key/);

      const outputPath = path.join(dir, 'out.md');
      writeFileSync(outputPath, 'ok\n');
      assert.throws(() => {
        buildHandoff({
          dispatchId: 'hash',
          system: 'conclave',
          seat: 'implementer',
          status: 'done',
          briefPath,
          outputPaths: [outputPath],
          outputSha256s: { [outputPath]: '0'.repeat(64) },
          nextOwner: 'reviewer',
        });
      }, /outputSha256s mismatch/);
    });

    const outsider = mkdtempSync(path.join(tmpdir(), 'conclave-handoff-out-'));
    try {
      writeFileSync(path.join(outsider, 'brief.md'), 'outside\n');
      assert.throws(() => {
        buildHandoff({
          dispatchId: 'jail',
          system: 'conclave',
          seat: 'implementer',
          status: 'accepted',
          briefPath: path.join(outsider, 'brief.md'),
          nextOwner: '',
        });
      }, /outside the pointer zones/);
    } finally {
      rmSync(outsider, { recursive: true, force: true });
    }
  });

  it('allows CONCLAVE_BUS_ROOT outputs and refuses a prefix-trap bus path', () => {
    const bus = mkdtempSync(path.join(tmpdir(), 'conclave-handoff-bus-'));
    try {
      withBusRoot(bus, () => {
        const briefPath = path.join(bus, 'brief.md');
        const outputPath = path.join(bus, 'out.md');
        writeFileSync(briefPath, 'bus-handoff\n');
        writeFileSync(outputPath, 'bus-out\n');
        const envelope = buildHandoff({
          dispatchId: 'bus-h',
          hostMode: 'cursor-cli',
          seat: 'gemini-implementer',
          status: 'accepted',
          briefPath,
          outputPaths: [outputPath],
          nextOwner: 'verifier',
          ts: '2026-09-04T09:02:00.000Z',
        });
        assert.strictEqual(envelope.system, 'conclave-cli');
        assert.strictEqual(envelope.outputSha256s[path.resolve(outputPath)], sha256('bus-out\n'));

        assert.throws(() => {
          buildHandoff({
            dispatchId: 'trap',
            system: 'conclave',
            seat: 'implementer',
            status: 'failed',
            briefPath: `${bus}-evil${path.sep}brief.md`,
            nextOwner: '',
          });
        }, /outside the pointer zones/);
      });
    } finally {
      rmSync(bus, { recursive: true, force: true });
    }
  });

  it('uses Conclave firstLine split on the brief, not cli-pointer CR-keeping firstLine', () => {
    withTempDir((dir) => {
      const { briefPath } = seedBrief(dir, 'crlf.md', 'HANDOFF-CRLF\r\nbody\n');
      assert.strictEqual(firstLineUtf8File(briefPath), 'HANDOFF-CRLF');
      assert.strictEqual(inspectBrief(briefPath).firstLine, 'HANDOFF-CRLF\r');
      const envelope = buildHandoff({
        dispatchId: 'crlf-h',
        system: 'conclave',
        seat: 'implementer',
        status: 'accepted',
        briefPath,
        nextOwner: 'reviewer',
        ts: '2026-09-04T09:02:45.000Z',
      });
      assert.strictEqual(envelope.briefSha256, sha256Utf8File(briefPath));
      assert.strictEqual(Object.hasOwn(envelope, 'firstLineEcho'), false);
    });
  });

  it('hashes invalid UTF-8 outputs as decoded text, not the raw buffer', () => {
    withTempDir((dir) => {
      const { briefPath } = seedBrief(dir);
      const outputPath = path.join(dir, 'out.bin.md');
      writeFileSync(outputPath, Buffer.from([0x6f, 0x6b, 0x0a, 0xff]));
      const envelope = buildHandoff({
        dispatchId: 'utf8-out',
        system: 'conclave',
        seat: 'implementer',
        status: 'done',
        briefPath,
        outputPaths: [outputPath],
        nextOwner: 'reviewer',
        ts: '2026-09-04T09:02:30.000Z',
      });
      const resolved = path.resolve(outputPath);
      assert.strictEqual(envelope.outputSha256s[resolved], sha256Utf8File(outputPath));
      assert.notStrictEqual(envelope.outputSha256s[resolved], inspectBrief(outputPath).sha256);
    });
  });

  it('CLI validates and appends; --validate does not write', () => {
    withTempDir((dir) => {
      const { briefPath } = seedBrief(dir);
      const log = path.join(dir, 'handoffs.jsonl');
      const row = {
        dispatchId: 'cli-h',
        hostMode: 'cursor',
        seat: 'reviewer',
        status: 'accepted',
        briefPath,
        nextOwner: 'verifier',
        uncertainties: [],
        doNotAssume: ['owner merge'],
        ts: '2026-09-04T09:03:00.000Z',
      };
      const validated = run(['--validate', '--row', JSON.stringify(row)]);
      assert.strictEqual(validated.status, 0, validated.stderr);
      assert.match(validated.stdout, /HANDOFF VALID cli-h\/reviewer/);
      assert.strictEqual(existsOrEmpty(log), true);

      const appended = run(['--row', JSON.stringify(row), '--log', log]);
      assert.strictEqual(appended.status, 0, appended.stderr);
      assert.match(appended.stdout, /HANDOFF accepted cli-h\/reviewer/);
      const lines = readFileSync(log, 'utf8').trim().split('\n');
      assert.strictEqual(lines.length, 1);
      assert.strictEqual(JSON.parse(lines[0]).schema, SCHEMA_ID);

      const bad = run(['--validate', '--row', JSON.stringify({ ...row, status: 'nope' })]);
      assert.strictEqual(bad.status, 1);
      assert.match(bad.stderr, /invalid status/);
    });
  });
});

function existsOrEmpty(filePath) {
  try {
    readFileSync(filePath);
    return false;
  } catch {
    return true;
  }
}

function existsSyncSafe(filePath) {
  try {
    readFileSync(filePath);
    return true;
  } catch {
    return false;
  }
}
