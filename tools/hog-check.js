'use strict';

const { readFileSync } = require('node:fs');

const path = process.argv[2];
if (!path) {
  console.error('Usage: node tools/hog-check.js <jsonl-path>');
  process.exit(1);
}

let text;
try {
  text = readFileSync(path, 'utf8');
} catch (err) {
  console.error(`Failed to read ${path}: ${err.message}`);
  process.exit(1);
}

const rows = [];
for (const line of text.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  try {
    rows.push(JSON.parse(trimmed));
  } catch (err) {
    console.error(`Failed to parse JSONL line: ${trimmed}`);
    process.exit(1);
  }
}

const implementRows = rows.filter(r => r.role === 'implement');

if (implementRows.length === 0) {
  console.error('NO IMPLEMENT ROWS');
  process.exit(1);
}

const counts = {};
for (const row of implementRows) {
  counts[row.vendor] = (counts[row.vendor] || 0) + 1;
}

const total = implementRows.length;
for (const [vendor, count] of Object.entries(counts)) {
  const share = count / total;
  if (share > 0.6) {
    console.error(`FLOOR TRIPPED ${vendor} ${Math.round(share * 100)}`);
    process.exit(1);
  }
}

const implementVendors = Object.keys(counts);
if (implementVendors.length < 3) {
  console.error(`IDLE SEAT expected 3 implement vendors got ${implementVendors.length}`);
  process.exit(1);
}

console.log('FLOOR HOLDS');
process.exit(0);
