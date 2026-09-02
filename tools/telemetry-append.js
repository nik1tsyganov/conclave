#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const allowed = {
  vendor: new Set(['anthropic', 'openai', 'google']),
  role: new Set(['implement', 'verify', 'review']),
  hostMode: new Set(['cursor', 'cursor-cli']),
};

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
    if (arg === '--row') {
      if (rowText !== undefined) fail('duplicate --row');
      rowText = takeValue(args, i);
      i += 1;
    } else if (arg === '--file') {
      if (inputFile !== undefined) fail('duplicate --file');
      inputFile = takeValue(args, i);
      i += 1;
    } else if (arg === '--log') {
      logPath = path.resolve(takeValue(args, i));
      i += 1;
    } else {
      fail(`unknown argument ${arg}`);
    }
  }

  if ((rowText === undefined) === (inputFile === undefined)) {
    fail('use exactly one of --row or --file');
  }

  if (inputFile !== undefined) {
    try {
      rowText = fs.readFileSync(path.resolve(inputFile), 'utf8');
    } catch (error) {
      fail(`cannot read input file: ${error.message}`);
    }
  }

  return { rowText, logPath };
}

function validate(row) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) fail('row must be a JSON object');

  for (const [field, values] of Object.entries(allowed)) {
    if (!values.has(row[field])) fail(`invalid ${field}`);
  }

  if (row.routedBy !== 'arbiter') fail('invalid routedBy');
  if (Object.hasOwn(row, 'capturedBy') && row.capturedBy !== 'lead') fail('invalid capturedBy');

  if (Object.hasOwn(row, 'date')) {
    const validFormat = typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date);
    const parsed = validFormat ? new Date(`${row.date}T00:00:00Z`) : null;
    if (!validFormat || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== row.date) {
      fail('invalid date');
    }
  }

  for (const field of ['vendorSideTokens', 'totalTokens']) {
    if (!Object.hasOwn(row, field)) continue;
    const value = row[field];
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
      fail(`invalid ${field}`);
    }
  }
}

const { rowText, logPath } = parseArgs(process.argv.slice(2));

let row;
try {
  row = JSON.parse(rowText);
} catch (error) {
  fail(`invalid JSON: ${error.message}`);
}

validate(row);

try {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, 'utf8');
} catch (error) {
  fail(`cannot write log: ${error.message}`, 2);
}

console.log(`appended ${row.vendor}/${row.role} ${logPath}`);
