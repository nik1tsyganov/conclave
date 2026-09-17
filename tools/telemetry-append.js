#!/usr/bin/env node
// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with section 7 terms; see LICENSE.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateDispatchRow } = require('./dispatch-schema.js');
const { appendUniqueRow, verifyCommittedRow } = require('./dispatch-evidence.js');

function fail(reason, status = 1) {
  console.error(String(reason).replace(/[\r\n]+/g, ' '));
  process.exit(status);
}
function takeValue(args, index) {
  if (index + 1 >= args.length) fail(`missing value for ${args[index]}`);
  return args[index + 1];
}
function parseArgs(args) {
  let rowText;
  let inputFile;
  let logPath = path.resolve(__dirname, '..', 'telemetry', 'dispatches.jsonl');
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--row') { if (rowText !== undefined) fail('duplicate --row'); rowText = takeValue(args, i); i += 1; }
    else if (arg === '--file') { if (inputFile !== undefined) fail('duplicate --file'); inputFile = takeValue(args, i); i += 1; }
    else if (arg === '--log') { logPath = path.resolve(takeValue(args, i)); i += 1; }
    else fail(`unknown argument ${arg}`);
  }
  if ((rowText === undefined) === (inputFile === undefined)) fail('use exactly one of --row or --file');
  if (inputFile !== undefined) {
    try { rowText = fs.readFileSync(path.resolve(inputFile), 'utf8'); }
    catch (error) { fail(`cannot read input file: ${error.message}`); }
  }
  return { rowText, logPath };
}

const { rowText, logPath } = parseArgs(process.argv.slice(2));
let row;
try { row = JSON.parse(rowText); }
catch (error) { fail(`invalid JSON: ${error.message}`); }
try {
  validateDispatchRow(row, {
    requireHostMode: true,
    requireCursorCli: row.hostMode === 'cursor-cli' || row.hostMode === 'synara',
    requireArbiter: row.hostMode === 'cursor-cli' || row.hostMode === 'synara',
    requireDispatchId: row.schemaVersion === 1,
    requireUnitId: row.schemaVersion === 1,
    requireProof: row.schemaVersion === 1,
  });
  if (row.schemaVersion === 2) verifyCommittedRow(row);
} catch (error) {
  fail(error.message);
}
try {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  appendUniqueRow(logPath, row);
} catch (error) {
  fail(`cannot write log: ${error.message}`, 2);
}
console.log(`appended ${row.vendor}/${row.role} ${logPath}`);
