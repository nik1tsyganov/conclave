// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const { readFileSync } = require('node:fs');
const { validateDispatchRow } = require('./dispatch-schema.js');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node tools/hog-check.js <jsonl-path>');
  process.exit(1);
}

let text;
try { text = readFileSync(inputPath, 'utf8'); }
catch (err) { console.error(`Failed to read ${inputPath}: ${err.message}`); process.exit(1); }

const rows = [];
for (const line of text.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  let row;
  try { row = JSON.parse(trimmed); }
  catch { console.error(`Failed to parse JSONL line: ${trimmed}`); process.exit(1); }
  try { validateDispatchRow(row); }
  catch (error) { console.error(`INVALID DISPATCH ROW: ${error.message}`); process.exit(1); }
  rows.push(row);
}

const implementRows = rows.filter((r) => r.role === 'implement');
if (implementRows.length === 0) { console.error('NO IMPLEMENT ROWS'); process.exit(1); }

// New schema rows are unique per dispatch/unit/vendor. Duplicate accounting can
// otherwise manufacture a floor result without an additional seat actually running.
const seen = new Set();
for (const row of implementRows) {
  if (typeof row.dispatchId !== 'string' || !row.dispatchId || typeof row.unitId !== 'string' || !row.unitId) {
    console.error('IMPLEMENT ROW MISSING IDENTITY');
    process.exit(1);
  }
  const key = `${row.dispatchId}\u0000${row.unitId}\u0000${row.vendor}`;
  if (seen.has(key)) { console.error(`DUPLICATE IMPLEMENT ROW ${row.dispatchId}/${row.unitId}/${row.vendor}`); process.exit(1); }
  seen.add(key);
}

const counts = {};
for (const row of implementRows) counts[row.vendor] = (counts[row.vendor] || 0) + 1;
const total = implementRows.length;
for (const [vendor, count] of Object.entries(counts)) {
  const share = count / total;
  if (share > 0.6) { console.error(`FLOOR TRIPPED ${vendor} ${Math.round(share * 100)}`); process.exit(1); }
}

const implementVendors = Object.keys(counts);
if (implementVendors.length < 3) { console.error(`IDLE SEAT expected 3 implement vendors got ${implementVendors.length}`); process.exit(1); }
console.log('FLOOR HOLDS');
process.exit(0);
