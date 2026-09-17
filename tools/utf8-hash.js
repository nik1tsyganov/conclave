// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

/**
 * UTF-8 SHA-256 for receipt.v1 and handoff-envelope.v1.
 *
 * Encoding: UTF-8 only. Read the file as UTF-8 text
 * (`fs.readFileSync(path, 'utf8')`), strip a single leading U+FEFF
 * (BOM) to match Conclave `sha256Utf8`, then hash that string with
 * `crypto.createHash('sha256').update(text, 'utf8')`. Invalid UTF-8 is
 * replaced by Node's decoder (U+FFFD) before hashing.
 *
 * This is the Conclave-aligned hash. Do not hash the raw Buffer here —
 * `cli-pointer.js` still hashes raw bytes for pointer identity (BOM
 * bytes stay in that digest). Receipt and handoff hashes must go
 * through this helper so Conclave raw-buffer vs Conclave UTF-8 does not
 * diverge when cross-hashing.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');

const HASH_ENCODING = 'utf8';
const UTF8_BOM = '\uFEFF';

// Conclave strips one leading U+FEFF after UTF-8 decode, then hashes /
// takes the first line. A second BOM and a mid-text U+FEFF stay.
function stripLeadingBom(text) {
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text;
}

function sha256Utf8(text) {
  if (typeof text !== 'string') {
    throw new Error('sha256Utf8 requires a UTF-8 string; decode the file as utf8 first');
  }
  return crypto.createHash('sha256').update(stripLeadingBom(text), HASH_ENCODING).digest('hex');
}

function readUtf8File(filePath) {
  return fs.readFileSync(filePath, HASH_ENCODING);
}

function sha256Utf8File(filePath) {
  return sha256Utf8(readUtf8File(filePath));
}

// Conclave inspectBrief first-line: strip one leading U+FEFF, split on
// \r?\n, then strip a leftover CR. Receipt/handoff firstLineEcho uses
// this. cli-pointer.js still matches through the first LF only for
// pointer identity — leave that raw-buffer path alone.
function firstLineUtf8(text) {
  if (typeof text !== 'string') {
    throw new Error('firstLineUtf8 requires a UTF-8 string');
  }
  return stripLeadingBom(text).split(/\r?\n/)[0].replace(/\r$/, '');
}

function firstLineUtf8File(filePath) {
  return firstLineUtf8(readUtf8File(filePath));
}

module.exports = {
  HASH_ENCODING,
  sha256Utf8,
  readUtf8File,
  sha256Utf8File,
  firstLineUtf8,
  firstLineUtf8File,
};
