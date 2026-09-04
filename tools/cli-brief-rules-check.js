#!/usr/bin/env node
'use strict';

/**
 * Magi CLI brief RULES gate.
 *
 * Fail-closed: a seat brief is legal only when it carries the vault RULES
 * markers. CLI seats cannot load Cursor plugins, so standing rules arrive
 * through the brief (see .cursor/skills/magi/references/brief-rules-block.md).
 *
 * Exit 0 rules ok; 1 missing markers; 2 ARGUMENT_ERROR.
 */

const fs = require('node:fs');
const path = require('node:path');

const STANDING_PATH = 'C:\\src\\ai-ops-vault\\projects\\magi-cli-rules\\STANDING.md';
const RULES_DIR = 'C:\\src\\ai-ops-vault\\projects\\magi-cli-rules';
const VENDOR_MD = 'VENDOR.md';
const RULES_INDEX = 'RULES/INDEX.md';

const REQUIRED_MARKERS = Object.freeze([
  {
    id: 'RULES/INDEX|magi-cli-rules|STANDING',
    anyOf: Object.freeze([
      'RULES/INDEX.md',
      'RULES/INDEX',
      'RULES\\INDEX.md',
      'magi-cli-rules',
      'STANDING.md',
      'STANDING',
    ]),
  },
  {
    id: 'magi-mode',
    anyOf: Object.freeze(['magi-mode']),
  },
  {
    id: 'magi-dispatch',
    anyOf: Object.freeze(['magi-dispatch']),
  },
  {
    id: 'mix-mode',
    anyOf: Object.freeze(['mix-mode']),
  },
  {
    // Research pin: casper_via=agy if google, or a Vendor: line on every seat.
    id: 'casper_via=agy|Vendor:',
    anyOf: Object.freeze(['casper_via=agy', 'Vendor:']),
  },
  {
    id: 'WRITE AUDIT|R07',
    anyOf: Object.freeze(['WRITE AUDIT', 'R07']),
  },
]);

function usage() {
  return [
    'Usage: node tools/cli-brief-rules-check.js --brief <file>',
    '',
    'Fails closed unless the brief contains the Magi CLI RULES markers:',
    'magi-mode, magi-dispatch, mix-mode, casper_via=agy,',
    'RULES/INDEX or magi-cli-rules or STANDING, and WRITE AUDIT or R07.',
  ].join('\n');
}

function argumentError(message) {
  const error = new Error(message);
  error.code = 'ARGUMENT_ERROR';
  return error;
}

function rulesError(message) {
  const error = new Error(message);
  error.code = 'RULES_FAIL';
  return error;
}

function parseArgs(argv) {
  const options = { help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') {
      options.help = true;
    } else if (flag === '--brief') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw argumentError(`${flag} requires a value`);
      }
      options.brief = value;
      index += 1;
    } else {
      throw argumentError(`Unknown option: ${flag}`);
    }
  }
  return options;
}

function markerHolds(marker, text) {
  if (typeof marker.match === 'function') {
    return marker.match(text) === true;
  }
  return Array.isArray(marker.anyOf) && marker.anyOf.some((needle) => text.includes(needle));
}

function missingMarkers(text) {
  if (typeof text !== 'string') {
    return REQUIRED_MARKERS.map((marker) => marker.id);
  }
  const missing = [];
  for (const marker of REQUIRED_MARKERS) {
    if (!markerHolds(marker, text)) {
      missing.push(marker.id);
    }
  }
  return missing;
}

function checkBriefText(text) {
  const missing = missingMarkers(text);
  return { ok: missing.length === 0, missing };
}

function checkBriefFile(briefPath) {
  const resolved = path.resolve(briefPath);
  let body;
  try {
    body = fs.readFileSync(resolved, 'utf8');
  } catch {
    throw argumentError(`--brief file does not exist: ${resolved}`);
  }
  return { ...checkBriefText(body), briefPath: resolved };
}

function formatMissing(missing) {
  return `brief missing RULES markers: ${missing.join(', ')}`;
}

function main(argv = process.argv.slice(2), io = process) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      io.stdout.write(`${usage()}\n`);
      return 0;
    }
    if (typeof options.brief !== 'string' || options.brief.length === 0) {
      throw argumentError('--brief is required');
    }
    const result = checkBriefFile(options.brief);
    if (!result.ok) {
      throw rulesError(formatMissing(result.missing));
    }
    io.stdout.write(`${JSON.stringify({ ok: true, brief: result.briefPath })}\n`);
    return 0;
  } catch (error) {
    const code = error.code || 'RULES_FAIL';
    io.stderr.write(`${code}: ${error.message}\n`);
    return code === 'ARGUMENT_ERROR' ? 2 : 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  REQUIRED_MARKERS,
  RULES_DIR,
  RULES_INDEX,
  STANDING_PATH,
  VENDOR_MD,
  checkBriefFile,
  checkBriefText,
  formatMissing,
  main,
  missingMarkers,
  parseArgs,
  usage,
};
