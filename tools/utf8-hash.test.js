// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const path = require('node:path');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { inspectBrief } = require('./cli-pointer.js');
const { HASH_ENCODING, sha256Utf8, readUtf8File, sha256Utf8File, firstLineUtf8, firstLineUtf8File } = require('./utf8-hash.js');

const ROOT = path.resolve(__dirname, '..');

function rawBufferHash(filePath) {
  const buffer = require('node:fs').readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

describe('utf8-hash', () => {
  it('documents UTF-8 as the only hash encoding', () => {
    assert.strictEqual(HASH_ENCODING, 'utf8');
    assert.strictEqual(sha256Utf8('hello\n'), crypto.createHash('sha256').update('hello\n', 'utf8').digest('hex'));
    assert.strictEqual(sha256Utf8('привет'), crypto.createHash('sha256').update('привет', 'utf8').digest('hex'));
    assert.throws(() => sha256Utf8(Buffer.from('hello')), /UTF-8 string/);
  });

  it('matches raw-buffer hashes for valid UTF-8 and diverges on invalid bytes', () => {
    const dir = mkdtempSync(path.join(ROOT, 'temp-utf8-hash-'));
    try {
      const validPath = path.join(dir, 'valid.md');
      writeFileSync(validPath, 'FIRST\nvalid utf-8\n', 'utf8');
      assert.strictEqual(readUtf8File(validPath), 'FIRST\nvalid utf-8\n');
      assert.strictEqual(sha256Utf8File(validPath), rawBufferHash(validPath));
      assert.strictEqual(sha256Utf8File(validPath), inspectBrief(validPath).sha256);

      const invalidPath = path.join(dir, 'invalid.md');
      writeFileSync(invalidPath, Buffer.from([0x46, 0x49, 0x52, 0x53, 0x54, 0x0a, 0xff]));
      const decoded = readUtf8File(invalidPath);
      assert.ok(decoded.includes('\uFFFD'));
      assert.strictEqual(sha256Utf8File(invalidPath), sha256Utf8(decoded));
      assert.notStrictEqual(sha256Utf8File(invalidPath), rawBufferHash(invalidPath));
      assert.notStrictEqual(sha256Utf8File(invalidPath), inspectBrief(invalidPath).sha256);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('splits firstLine on /\\r?\\n/ and strips CR; pointer inspectBrief keeps CR', () => {
    const dir = mkdtempSync(path.join(ROOT, 'temp-utf8-cr-'));
    try {
      const crlfPath = path.join(dir, 'crlf.md');
      writeFileSync(crlfPath, 'FIRST-LINE\r\nsecond\n', 'utf8');
      assert.strictEqual(firstLineUtf8('FIRST-LINE\r\nsecond\n'), 'FIRST-LINE');
      assert.strictEqual(firstLineUtf8File(crlfPath), 'FIRST-LINE');
      assert.strictEqual(firstLineUtf8('FIRST-LINE\r'), 'FIRST-LINE');
      assert.strictEqual(inspectBrief(crlfPath).firstLine, 'FIRST-LINE\r');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('strips one leading U+FEFF (Conclave parity); cli-pointer keeps the raw-buffer digest', () => {
    const dir = mkdtempSync(path.join(ROOT, 'temp-utf8-bom-'));
    try {
      const body = 'BOM-FIRST\nsecond line\n';
      const bomPath = path.join(dir, 'bom.md');
      const plainPath = path.join(dir, 'plain.md');
      writeFileSync(bomPath, `\uFEFF${body}`, 'utf8');
      writeFileSync(plainPath, body, 'utf8');

      assert.strictEqual(readUtf8File(bomPath), `\uFEFF${body}`);
      assert.strictEqual(readUtf8File(plainPath), body);

      assert.strictEqual(sha256Utf8(`\uFEFF${body}`), sha256Utf8(body));
      assert.strictEqual(sha256Utf8File(bomPath), sha256Utf8(body));
      assert.strictEqual(sha256Utf8File(plainPath), sha256Utf8(body));
      assert.strictEqual(sha256Utf8File(bomPath), sha256Utf8File(plainPath));

      assert.strictEqual(firstLineUtf8(`\uFEFF${body}`), 'BOM-FIRST');
      assert.strictEqual(firstLineUtf8File(bomPath), 'BOM-FIRST');
      assert.strictEqual(firstLineUtf8File(plainPath), 'BOM-FIRST');
      assert.strictEqual(firstLineUtf8('\uFEFFhello'), 'hello');

      // Only one leading BOM is stripped (Conclave). A second leading
      // U+FEFF is hashed; a mid-text U+FEFF is never stripped.
      assert.strictEqual(
        sha256Utf8('\uFEFF\uFEFFx'),
        crypto.createHash('sha256').update('\uFEFFx', 'utf8').digest('hex')
      );
      assert.notStrictEqual(sha256Utf8('\uFEFF\uFEFFx'), sha256Utf8('x'));
      assert.notStrictEqual(sha256Utf8('a\uFEFFb'), sha256Utf8('ab'));

      // Pointer identity still hashes the raw buffer, including EF BB BF.
      const pointerBom = inspectBrief(bomPath);
      const pointerPlain = inspectBrief(plainPath);
      assert.strictEqual(pointerBom.sha256, rawBufferHash(bomPath));
      assert.strictEqual(pointerPlain.sha256, rawBufferHash(plainPath));
      assert.strictEqual(pointerPlain.sha256, sha256Utf8File(plainPath));
      assert.notStrictEqual(pointerBom.sha256, sha256Utf8File(bomPath));
      assert.notStrictEqual(pointerBom.sha256, pointerPlain.sha256);
      assert.strictEqual(pointerBom.firstLine, `\uFEFFBOM-FIRST`);
      assert.strictEqual(pointerPlain.firstLine, 'BOM-FIRST');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
