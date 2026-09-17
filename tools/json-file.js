// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const fs = require('node:fs');
const { TextDecoder } = require('node:util');

// Decode only; hashes continue to cover the original bytes, including any BOM.
// Some editors write a leading UTF-8 BOM; it is accepted and still hashed.
function parseJsonBytes(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('JSON input must use UTF-8; save it with UTF-8 encoding'); }
  return JSON.parse(text);
}
function readJsonFile(file) { return parseJsonBytes(fs.readFileSync(file)); }
module.exports = { parseJsonBytes, readJsonFile };
