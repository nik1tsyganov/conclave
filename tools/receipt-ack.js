#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

/**
 * CONCLAVE receipt ACK (receipt.v1).
 *
 * Conclave-aligned ACK that a seat opened the pointer brief: dispatchId,
 * seat, briefPath, briefSha256, firstLineEcho, ts. No Conclave join key.
 *
 * Cursor Task returns via chat reply only — there is no Task capture
 * module (unlike Conclave CLI --capture). Persistence is the explicit disk
 * write from acknowledgeReceipt / writeReceipt. Do not invent a hook.
 *
 * briefSha256 is UTF-8 SHA-256 (tools/utf8-hash.js), not the raw-buffer
 * hash cli-pointer.js prints on the pointer line.
 *
 * Works for any hostMode in tools/dispatch-schema.js, which is the only list of them.
 * Does not replace Task/CLI pointer delivery (cli-pointer.js / task-delivery.js).
 *
 *   node tools/receipt-ack.js --dispatch-id ID --seat SEAT --brief PATH \
 *     [--echo LINE] [--out PATH] [--host-mode MODE]
 *   node tools/receipt-ack.js --validate --file receipt.json
 */

const fs = require('node:fs');
const path = require('node:path');
const { inspectBrief } = require('./cli-pointer.js');
const { assertHostMode, assertInJail } = require('./conclave-bus-path.js');
const { firstLineUtf8, firstLineUtf8File, sha256Utf8File } = require('./utf8-hash.js');

const SCHEMA_ID = 'receipt.v1';
const REQUIRED = Object.freeze([
  'dispatchId',
  'seat',
  'briefPath',
  'briefSha256',
  'firstLineEcho',
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

class ReceiptError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReceiptError';
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
    throw new ReceiptError(`invalid ${field}`);
  }
  return value;
}

function requireIsoTimestamp(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ReceiptError('invalid ts');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ReceiptError('invalid ts');
  }
  return value;
}

function requireSha256(value, field = 'briefSha256') {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new ReceiptError(`invalid ${field}`);
  }
  return value;
}

function rejectJoinKeys(row) {
  for (const field of JOIN_KEY_FIELDS) {
    if (Object.hasOwn(row, field)) {
      throw new ReceiptError(`do not invent Conclave join key: ${field}`);
    }
  }
}

function inspectJailedBrief(briefPath) {
  const resolved = assertInJail(briefPath, 'briefPath');
  const info = inspectBrief(resolved);
  if (info.bytes === 0) {
    throw new ReceiptError(`Brief file is empty: ${info.briefPath}`);
  }
  return {
    briefPath: info.briefPath,
    firstLine: firstLineUtf8File(resolved),
    sha256Utf8: sha256Utf8File(resolved),
  };
}

function buildReceipt(input) {
  if (!isObject(input)) {
    throw new ReceiptError('receipt input must be a JSON object');
  }
  if (input.hostMode !== undefined) {
    assertHostMode(input.hostMode);
  }
  rejectJoinKeys(input);

  const info = inspectJailedBrief(input.briefPath);
  const firstLineEcho = firstLineUtf8(
    input.firstLineEcho === undefined ? info.firstLine : input.firstLineEcho,
  );
  if (firstLineEcho !== info.firstLine) {
    throw new ReceiptError('firstLineEcho does not match brief first line');
  }

  const receipt = {
    schema: SCHEMA_ID,
    dispatchId: requireNonEmptyString(input.dispatchId, 'dispatchId'),
    seat: requireNonEmptyString(input.seat, 'seat'),
    briefPath: info.briefPath,
    briefSha256: info.sha256Utf8,
    firstLineEcho,
    ts: input.ts === undefined ? new Date().toISOString() : requireIsoTimestamp(input.ts),
  };
  validateReceipt(receipt);
  return receipt;
}

function validateReceipt(receipt) {
  if (!isObject(receipt)) {
    throw new ReceiptError('receipt must be a JSON object');
  }
  rejectJoinKeys(receipt);
  if (receipt.schema !== SCHEMA_ID) {
    throw new ReceiptError('invalid schema');
  }
  for (const field of REQUIRED) {
    if (!Object.hasOwn(receipt, field)) {
      throw new ReceiptError(`invalid ${field}`);
    }
  }
  requireNonEmptyString(receipt.dispatchId, 'dispatchId');
  requireNonEmptyString(receipt.seat, 'seat');
  requireSha256(receipt.briefSha256, 'briefSha256');
  requireIsoTimestamp(receipt.ts);
  if (typeof receipt.firstLineEcho !== 'string') {
    throw new ReceiptError('invalid firstLineEcho');
  }

  const info = inspectJailedBrief(receipt.briefPath);
  if (receipt.briefPath !== info.briefPath) {
    throw new ReceiptError('invalid briefPath');
  }
  if (receipt.briefSha256 !== info.sha256Utf8) {
    throw new ReceiptError('briefSha256 does not match brief');
  }
  if (receipt.firstLineEcho !== info.firstLine) {
    throw new ReceiptError('firstLineEcho does not match brief first line');
  }
  return { ok: true, error: null };
}

function writeReceipt(receipt, destPath) {
  validateReceipt(receipt);
  const target =
    destPath === undefined || destPath === null || destPath === ''
      ? `${receipt.briefPath}.receipt.json`
      : destPath;
  const resolved = assertInJail(target, 'receiptPath');
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(receipt)}\n`, 'utf8');
  return resolved;
}

function acknowledgeReceipt(input, destPath) {
  const receipt = buildReceipt(input);
  const receiptPath = writeReceipt(receipt, destPath);
  return { receipt, receiptPath };
}

function parseArgs(args) {
  let dispatchId;
  let seat;
  let briefPath;
  let firstLineEcho;
  let outPath;
  let hostMode;
  let filePath;
  let validateOnly = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dispatch-id') {
      dispatchId = takeValue(args, i);
      i += 1;
    } else if (arg === '--seat') {
      seat = takeValue(args, i);
      i += 1;
    } else if (arg === '--brief') {
      briefPath = takeValue(args, i);
      i += 1;
    } else if (arg === '--echo') {
      firstLineEcho = takeValue(args, i);
      i += 1;
    } else if (arg === '--out') {
      outPath = takeValue(args, i);
      i += 1;
    } else if (arg === '--host-mode') {
      hostMode = takeValue(args, i);
      i += 1;
    } else if (arg === '--file') {
      filePath = takeValue(args, i);
      i += 1;
    } else if (arg === '--validate') {
      validateOnly = true;
    } else {
      fail(`unknown argument ${arg}`, 2);
    }
  }

  return { dispatchId, seat, briefPath, firstLineEcho, outPath, hostMode, filePath, validateOnly };
}

function main(argv) {
  const parsed = parseArgs(argv);
  try {
    if (parsed.validateOnly) {
      if (!parsed.filePath) fail('use --file with --validate', 2);
      const text = fs.readFileSync(path.resolve(parsed.filePath), 'utf8');
      const receipt = JSON.parse(text);
      validateReceipt(receipt);
      console.log(`RECEIPT VALID ${receipt.dispatchId}/${receipt.seat}`);
      return 0;
    }
    if (!parsed.dispatchId || !parsed.seat || !parsed.briefPath) {
      fail('required: --dispatch-id --seat --brief', 2);
    }
    const { receipt, receiptPath } = acknowledgeReceipt({
      dispatchId: parsed.dispatchId,
      seat: parsed.seat,
      briefPath: parsed.briefPath,
      firstLineEcho: parsed.firstLineEcho,
      hostMode: parsed.hostMode,
    }, parsed.outPath);
    console.log(`RECEIPT ACK ${receipt.dispatchId}/${receipt.seat} ${receiptPath}`);
    return 0;
  } catch (error) {
    if (error instanceof ReceiptError || error.message) {
      fail(error.message, 1);
    }
    throw error;
  }
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  SCHEMA_ID,
  ReceiptError,
  buildReceipt,
  validateReceipt,
  writeReceipt,
  acknowledgeReceipt,
};
