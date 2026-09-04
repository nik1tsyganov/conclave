#!/usr/bin/env node
'use strict';

/**
 * MAGI handoff envelope (handoff-envelope.v1).
 *
 * Append-only seat handoff rows for telemetry/handoffs.jsonl. This is not
 * the dispatch-row contract in telemetry/schema.json. No Conclave join key.
 *
 * Cursor Task returns via chat reply only — there is no Task capture
 * module (unlike Magi CLI --capture). Persistence is the explicit
 * appendFile from recordHandoff / appendHandoff. Do not invent a hook.
 *
 * briefSha256 and outputSha256s are UTF-8 SHA-256 (tools/utf8-hash.js).
 *
 *   node tools/handoff-envelope.js --row '<json>' [--log PATH]
 *   node tools/handoff-envelope.js --file row.json [--log PATH]
 *   node tools/handoff-envelope.js --validate --row '<json>'
 */

const fs = require('node:fs');
const path = require('node:path');
const { inspectBrief } = require('./cli-pointer.js');
const { assertHostMode, assertInJail } = require('./magi-bus-path.js');
const { firstLineUtf8File, sha256Utf8File } = require('./utf8-hash.js');

const SCHEMA_ID = 'handoff-envelope.v1';
const SYSTEMS = Object.freeze(['magi', 'magi-cli']);
const STATUSES = Object.freeze(['accepted', 'blocked', 'done', 'failed']);
const REQUIRED = Object.freeze([
  'dispatchId',
  'system',
  'seat',
  'status',
  'briefPath',
  'briefSha256',
  'outputPaths',
  'outputSha256s',
  'nextOwner',
  'uncertainties',
  'doNotAssume',
  'ts',
]);
const JOIN_KEY_FIELDS = Object.freeze([
  'conclaveId',
  'sessionId',
  'joinKey',
  'joinKeys',
  'correlationId',
  'camerlengo',
]);
const DEFAULT_LOG = path.resolve(__dirname, '..', 'telemetry', 'handoffs.jsonl');

class HandoffError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HandoffError';
  }
}

function fail(reason, status = 1) {
  console.error(String(reason).replace(/[\r\n]+/g, ' '));
  process.exit(status);
}

function takeValue(args, index) {
  if (index + 1 >= args.length) fail(`missing value for ${args[index]}`, 2);
  return args[index + 1];
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HandoffError(`invalid ${field}`);
  }
  return value;
}

function requireString(value, field) {
  if (typeof value !== 'string') {
    throw new HandoffError(`invalid ${field}`);
  }
  return value;
}

function requireIsoTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HandoffError('invalid ts');
  }
  if (!Number.isFinite(Date.parse(value))) {
    throw new HandoffError('invalid ts');
  }
  return value;
}

function requireSha256(value, field) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new HandoffError(`invalid ${field}`);
  }
  return value;
}

function requireStringArray(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new HandoffError(`invalid ${field}`);
  }
  return value;
}

function rejectJoinKeys(row) {
  for (const field of JOIN_KEY_FIELDS) {
    if (Object.hasOwn(row, field)) {
      throw new HandoffError(`do not invent Conclave join key: ${field}`);
    }
  }
}

function systemFromHostMode(hostMode) {
  assertHostMode(hostMode);
  if (hostMode === 'cursor') return 'magi';
  if (hostMode === 'cursor-cli') return 'magi-cli';
  const _exhaustive = hostMode;
  throw new HandoffError(`unhandled hostMode: ${_exhaustive}`);
}

function inspectJailedBrief(briefPath) {
  const resolved = assertInJail(briefPath, 'briefPath');
  const info = inspectBrief(resolved);
  if (info.bytes === 0) {
    throw new HandoffError(`Brief file is empty: ${info.briefPath}`);
  }
  return {
    briefPath: info.briefPath,
    firstLine: firstLineUtf8File(resolved),
    sha256Utf8: sha256Utf8File(resolved),
  };
}

function normalizeOutputPaths(outputPaths) {
  const list = outputPaths === undefined ? [] : outputPaths;
  if (!Array.isArray(list) || list.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new HandoffError('invalid outputPaths');
  }
  return list.map((item) => assertInJail(item, 'outputPath'));
}

function normalizeOutputSha256s(outputPaths, outputSha256s) {
  const hashes = outputSha256s === undefined ? {} : outputSha256s;
  if (!isObject(hashes)) {
    throw new HandoffError('invalid outputSha256s');
  }
  const resolvedKeys = new Set(outputPaths);
  const normalized = {};
  for (const outputPath of outputPaths) {
    const provided = Object.hasOwn(hashes, outputPath) ? hashes[outputPath] : undefined;
    const actual = sha256Utf8File(outputPath);
    if (provided !== undefined && provided !== actual) {
      throw new HandoffError(`outputSha256s mismatch for ${outputPath}`);
    }
    normalized[outputPath] = requireSha256(actual, 'outputSha256s');
  }
  for (const extra of Object.keys(hashes)) {
    let resolvedExtra;
    try {
      resolvedExtra = assertInJail(extra, 'outputPath');
    } catch {
      throw new HandoffError(`outputSha256s extra key ${extra}`);
    }
    if (!resolvedKeys.has(resolvedExtra)) {
      throw new HandoffError(`outputSha256s extra key ${extra}`);
    }
    if (hashes[extra] !== normalized[resolvedExtra]) {
      throw new HandoffError(`outputSha256s mismatch for ${extra}`);
    }
  }
  return normalized;
}

function buildHandoff(input) {
  if (!isObject(input)) {
    throw new HandoffError('handoff input must be a JSON object');
  }
  rejectJoinKeys(input);

  let system = input.system;
  if (system === undefined && input.hostMode !== undefined) {
    system = systemFromHostMode(input.hostMode);
  }
  if (!SYSTEMS.includes(system)) {
    throw new HandoffError('invalid system');
  }

  const info = inspectJailedBrief(input.briefPath);
  if (input.briefSha256 !== undefined && input.briefSha256 !== info.sha256Utf8) {
    throw new HandoffError('briefSha256 does not match brief');
  }

  const outputPaths = normalizeOutputPaths(input.outputPaths);
  const envelope = {
    schema: SCHEMA_ID,
    dispatchId: requireNonEmptyString(input.dispatchId, 'dispatchId'),
    system,
    seat: requireNonEmptyString(input.seat, 'seat'),
    status: input.status,
    briefPath: info.briefPath,
    briefSha256: info.sha256Utf8,
    outputPaths,
    outputSha256s: normalizeOutputSha256s(outputPaths, input.outputSha256s),
    nextOwner: requireString(input.nextOwner === undefined ? '' : input.nextOwner, 'nextOwner'),
    uncertainties: requireStringArray(input.uncertainties === undefined ? [] : input.uncertainties, 'uncertainties'),
    doNotAssume: requireStringArray(input.doNotAssume === undefined ? [] : input.doNotAssume, 'doNotAssume'),
    ts: input.ts === undefined ? new Date().toISOString() : requireIsoTimestamp(input.ts),
  };
  validateHandoff(envelope);
  return envelope;
}

function validateHandoff(envelope) {
  if (!isObject(envelope)) {
    throw new HandoffError('handoff must be a JSON object');
  }
  rejectJoinKeys(envelope);
  if (envelope.schema !== SCHEMA_ID) {
    throw new HandoffError('invalid schema');
  }
  for (const field of REQUIRED) {
    if (!Object.hasOwn(envelope, field)) {
      throw new HandoffError(`invalid ${field}`);
    }
  }
  requireNonEmptyString(envelope.dispatchId, 'dispatchId');
  if (!SYSTEMS.includes(envelope.system)) {
    throw new HandoffError('invalid system');
  }
  requireNonEmptyString(envelope.seat, 'seat');
  if (!STATUSES.includes(envelope.status)) {
    throw new HandoffError('invalid status');
  }
  requireSha256(envelope.briefSha256, 'briefSha256');
  requireString(envelope.nextOwner, 'nextOwner');
  requireStringArray(envelope.uncertainties, 'uncertainties');
  requireStringArray(envelope.doNotAssume, 'doNotAssume');
  requireIsoTimestamp(envelope.ts);

  const info = inspectJailedBrief(envelope.briefPath);
  if (envelope.briefPath !== info.briefPath) {
    throw new HandoffError('invalid briefPath');
  }
  if (envelope.briefSha256 !== info.sha256Utf8) {
    throw new HandoffError('briefSha256 does not match brief');
  }

  const outputPaths = normalizeOutputPaths(envelope.outputPaths);
  if (JSON.stringify(outputPaths) !== JSON.stringify(envelope.outputPaths)) {
    throw new HandoffError('invalid outputPaths');
  }
  const expectedHashes = normalizeOutputSha256s(outputPaths, envelope.outputSha256s);
  if (JSON.stringify(expectedHashes) !== JSON.stringify(envelope.outputSha256s)) {
    throw new HandoffError('invalid outputSha256s');
  }
  return { ok: true, error: null };
}

function appendHandoff(envelope, logPath) {
  validateHandoff(envelope);
  const target = logPath === undefined || logPath === null || logPath === '' ? DEFAULT_LOG : logPath;
  const resolved = assertInJail(target, 'handoffLog');
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.appendFileSync(resolved, `${JSON.stringify(envelope)}\n`, 'utf8');
  return resolved;
}

function recordHandoff(input, logPath) {
  const envelope = input && input.schema === SCHEMA_ID ? (validateHandoff(input), input) : buildHandoff(input);
  const handoffLog = appendHandoff(envelope, logPath);
  return { envelope, handoffLog };
}

function parseArgs(args) {
  let rowText;
  let inputFile;
  let logPath;
  let validateOnly = false;

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
      logPath = path.resolve(takeValue(args, i));
      i += 1;
    } else if (arg === '--validate') {
      validateOnly = true;
    } else {
      fail(`unknown argument ${arg}`, 2);
    }
  }

  if ((rowText === undefined) === (inputFile === undefined)) {
    fail('use exactly one of --row or --file', 2);
  }
  if (inputFile !== undefined) {
    try {
      rowText = fs.readFileSync(path.resolve(inputFile), 'utf8');
    } catch (error) {
      fail(`cannot read input file: ${error.message}`, 2);
    }
  }
  return { rowText, logPath, validateOnly };
}

function main(argv) {
  const { rowText, logPath, validateOnly } = parseArgs(argv);
  let raw;
  try {
    raw = JSON.parse(rowText);
  } catch (error) {
    fail(`invalid JSON: ${error.message}`);
  }
  try {
    if (validateOnly) {
      const envelope = raw.schema === SCHEMA_ID ? (validateHandoff(raw), raw) : buildHandoff(raw);
      console.log(`HANDOFF VALID ${envelope.dispatchId}/${envelope.seat}`);
    } else {
      const { envelope, handoffLog } = recordHandoff(raw, logPath);
      console.log(`HANDOFF ${envelope.status} ${envelope.dispatchId}/${envelope.seat} ${handoffLog}`);
    }
    return 0;
  } catch (error) {
    fail(error.message, 1);
  }
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  SCHEMA_ID,
  SYSTEMS,
  STATUSES,
  DEFAULT_LOG,
  HandoffError,
  systemFromHostMode,
  buildHandoff,
  validateHandoff,
  appendHandoff,
  recordHandoff,
};
