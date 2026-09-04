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

const REQUIRED_MARKERS = Object.freeze([
  {
    id: 'magi-cli-rules|STANDING.md',
    anyOf: Object.freeze(['magi-cli-rules', 'STANDING.md']),
  },
  {
    id: 'magi-mode',
    anyOf: Object.freeze(['magi-mode']),
  },
  {
    id: 'magi-dispatch',
    anyOf: Object.freeze(['magi-dispatch']),
  },
]);

function usage() {
  return [
    'Usage: node tools/cli-brief-rules-check.js --brief <file>',
    '',
    'Fails closed unless the brief contains the Magi CLI RULES markers:',
    'magi-cli-rules or STANDING.md, plus magi-mode and magi-dispatch.',
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

function missingMarkers(text) {
  if (typeof text !== 'string') {
    return REQUIRED_MARKERS.map((marker) => marker.id);
  }
  const missing = [];
  for (const marker of REQUIRED_MARKERS) {
    if (!marker.anyOf.some((needle) => text.includes(needle))) {
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
  STANDING_PATH,
  checkBriefFile,
  checkBriefText,
  formatMissing,
  main,
  missingMarkers,
  parseArgs,
  usage,
};
