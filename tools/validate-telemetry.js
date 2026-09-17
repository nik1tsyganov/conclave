#!/usr/bin/env node
// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with section 7 terms; see LICENSE.
'use strict';

/**
 * Validate MAGI telemetry rows against telemetry/schema.json.
 *
 *   node tools/validate-telemetry.js --row '<json>'
 *   node tools/validate-telemetry.js --file <row.json>
 *   node tools/validate-telemetry.js --log <dispatches.jsonl>
 *   node tools/validate-telemetry.js --adapt --row '<json>'
 *
 * Exit 0 = valid. Exit 1 = invalid row. Exit 2 = could not run.
 *
 * --adapt emits the documented ingest envelope. It does not invent a join
 * key toward Conclave hook rows (see telemetry/README.md).
 */

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_PATH = path.resolve(__dirname, '..', 'telemetry', 'schema.json');
const SCHEMA_ID = 'magi-dispatch/v1';

function fail(reason, status = 1) {
  console.error(String(reason).replace(/[\r\n]+/g, ' '));
  process.exit(status);
}

function takeValue(args, index) {
  if (index + 1 >= args.length) fail(`missing value for ${args[index]}`, 2);
  return args[index + 1];
}

function loadSchema() {
  try {
    return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  } catch (error) {
    fail(`cannot read schema: ${error.message}`, 2);
  }
}

function parseArgs(args) {
  let rowText;
  let inputFile;
  let logPath;
  let adapt = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--row') {
      if (rowText !== undefined) fail('duplicate --row', 2);
      rowText = takeValue(args, i);
      i += 1;
    } else if (arg === '--file') {
      if (inputFile !== undefined) fail('duplicate --file', 2);
      inputFile = takeValue(args, i);
      i += 1;
    } else if (arg === '--log') {
      if (logPath !== undefined) fail('duplicate --log', 2);
      logPath = path.resolve(takeValue(args, i));
      i += 1;
    } else if (arg === '--adapt') {
      adapt = true;
    } else {
      fail(`unknown argument ${arg}`, 2);
    }
  }

  const sources = [rowText !== undefined, inputFile !== undefined, logPath !== undefined].filter(Boolean).length;
  if (sources !== 1) fail('use exactly one of --row, --file, or --log', 2);

  if (inputFile !== undefined) {
    try {
      rowText = fs.readFileSync(path.resolve(inputFile), 'utf8');
    } catch (error) {
      fail(`cannot read input file: ${error.message}`, 2);
    }
  }

  return { rowText, logPath, adapt };
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value, type) {
  if (type === 'object') return typeOf(value) === 'object';
  return typeOf(value) === type;
}

function validateEnumOrConst(field, value, spec) {
  if (Object.hasOwn(spec, 'const') && value !== spec.const) {
    return `invalid ${field}`;
  }
  if (Object.hasOwn(spec, 'enum') && !spec.enum.includes(value)) {
    return `invalid ${field}`;
  }
  return null;
}

function validateNumberSpec(field, value, spec) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `invalid ${field}`;
  if (Object.hasOwn(spec, 'exclusiveMinimum') && !(value > spec.exclusiveMinimum)) {
    return `invalid ${field}`;
  }
  return null;
}

function validateStringSpec(field, value, spec) {
  if (typeof value !== 'string') return `invalid ${field}`;
  if (Object.hasOwn(spec, 'pattern') && !new RegExp(spec.pattern).test(value)) {
    return `invalid ${field}`;
  }
  return validateEnumOrConst(field, value, spec);
}

function validateAnyOf(field, value, specs) {
  for (const spec of specs) {
    if (validatePropertySpec(field, value, spec) === null) return null;
  }
  return `invalid ${field}`;
}

function validatePropertySpec(field, value, spec) {
  if (spec.anyOf) return validateAnyOf(field, value, spec.anyOf);
  if (spec.type === 'null') return value === null ? null : `invalid ${field}`;
  if (spec.type === 'number') return validateNumberSpec(field, value, spec);
  if (spec.type === 'string') return validateStringSpec(field, value, spec);
  if (spec.type && !matchesType(value, spec.type)) return `invalid ${field}`;
  return validateEnumOrConst(field, value, spec);
}

function isValidCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateRow(row, schema) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    return { ok: false, error: 'row must be a JSON object' };
  }
  if (!schema || schema.type !== 'object') {
    return { ok: false, error: 'schema must describe an object' };
  }

  for (const field of schema.required || []) {
    if (!Object.hasOwn(row, field)) {
      return { ok: false, error: `invalid ${field}` };
    }
  }

  const properties = schema.properties || {};
  for (const [field, spec] of Object.entries(properties)) {
    if (!Object.hasOwn(row, field)) continue;
    const error = validatePropertySpec(field, row[field], spec);
    if (error) return { ok: false, error };
    if (field === 'date' && !isValidCalendarDate(row.date)) {
      return { ok: false, error: 'invalid date' };
    }
  }

  return { ok: true, error: null };
}

function adaptMagiRow(row) {
  return {
    schemaId: SCHEMA_ID,
    sourceSystem: 'magi',
    correlationPolicy: 'none',
    joinKeys: [],
    payload: row,
  };
}

function readJsonl(logPath) {
  let text;
  try {
    text = fs.readFileSync(logPath, 'utf8');
  } catch (error) {
    fail(`cannot read log: ${error.message}`, 2);
  }
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      rows.push({ line: i + 1, row: JSON.parse(line) });
    } catch (error) {
      fail(`invalid JSON at line ${i + 1}: ${error.message}`);
    }
  }
  return rows;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`invalid JSON: ${error.message}`);
  }
}

function main(argv) {
  const schema = loadSchema();
  const { rowText, logPath, adapt } = parseArgs(argv);

  if (logPath !== undefined) {
    const rows = readJsonl(logPath);
    for (const { line, row } of rows) {
      const result = validateRow(row, schema);
      if (!result.ok) fail(`line ${line}: ${result.error}`);
    }
    if (adapt) {
      console.log(JSON.stringify(rows.map(({ row }) => adaptMagiRow(row)), null, 2));
    } else {
      console.log(`TELEMETRY VALID ${rows.length}`);
    }
    return 0;
  }

  const row = parseJson(rowText);
  const result = validateRow(row, schema);
  if (!result.ok) fail(result.error);
  if (adapt) {
    console.log(JSON.stringify(adaptMagiRow(row), null, 2));
  } else {
    console.log(`TELEMETRY VALID ${row.vendor}/${row.role}`);
  }
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  SCHEMA_PATH,
  SCHEMA_ID,
  loadSchema,
  validateRow,
  adaptMagiRow,
  isValidCalendarDate,
};
