'use strict';
const fs = require('node:fs');
const { TextDecoder } = require('node:util');

// Decode only; hashes continue to cover the original bytes, including any BOM.
// PowerShell 5.1 Set-Content -Encoding UTF8 writes a leading UTF-8 BOM.
function parseJsonBytes(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('JSON input must use UTF-8; save it with UTF-8 encoding'); }
  return JSON.parse(text);
}
function readJsonFile(file) { return parseJsonBytes(fs.readFileSync(file)); }
module.exports = { parseJsonBytes, readJsonFile };
