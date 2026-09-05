#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { verifyStagedRules } = require('./cli-rules-stage.js');
const { ROLES } = require('./dispatch-schema.js');

const STANDING_PATH = 'C:\\src\\ai-ops-vault\\projects\\magi-cli-rules\\STANDING.md';
const RULES_DIR = 'C:\\src\\ai-ops-vault\\projects\\magi-cli-rules';
const VENDOR_MD = 'VENDOR.md';
const RULES_INDEX = 'RULES/INDEX.md';

const REQUIRED_MARKERS = Object.freeze([
  { id: 'RULES/INDEX|magi-cli-rules|STANDING', anyOf: ['RULES/INDEX.md', 'RULES/INDEX', 'RULES\\INDEX.md', 'magi-cli-rules', 'STANDING.md', 'STANDING'] },
  { id: 'SEAT-CONTRACT', anyOf: ['SEAT-CONTRACT.md', 'seat contract'] },
  { id: 'skills-manifest', anyOf: ['skills-manifest.json', 'staged skills'] },
  { id: 'WRITE AUDIT|R07', anyOf: ['WRITE AUDIT', 'R07'] },
]);

const STRICT_MARKERS = Object.freeze([
  { id: 'hostMode: cursor-cli', anyOf: ['hostMode: cursor-cli', 'hostMode `cursor-cli`'] },
  { id: 'pointer-only', anyOf: ['pointer-only', 'pointer only', 'pointer delivery'] },
  { id: 'leaf seat', anyOf: ['leaf seat', 'no fan-out', 'MUST NOT sub-dispatch'] },
  { id: 'receipt/handoff', anyOf: ['receipt ACK', 'receipt-ack', 'handoff envelope', 'handoff-envelope'] },
  { id: 'telemetry', anyOf: ['telemetry', 'R17'] },
  { id: 'vendor proof', anyOf: ['vendor-native proof', 'cli-proof', 'R18'] },
  { id: 'SLICES not vendors', anyOf: ['SLICES≠vendors', 'SLICES are not vendor', 'SLICES not vendor', 'R11'] },
  { id: 'not CONCLAVE', anyOf: ['not CONCLAVE', 'NOT CONCLAVE', 'R20'] },
  { id: 'no vault writes', anyOf: ['C:\\src\\vault', 'R21'] },
]);

function usage() {
  return [
    'Usage: node tools/cli-brief-rules-check.js --brief <file> [--role implement|review|verify|plan|research] [--vendor openai|google|anthropic] [--structural]',
    'Exit 0 rules ok. Exit 1 missing/invalid rules. Exit 2 ARGUMENT_ERROR.',
  ].join('\n');
}
function argumentError(message) { const e = new Error(message); e.code = 'ARGUMENT_ERROR'; return e; }
function rulesError(message) { const e = new Error(message); e.code = 'RULES_FAIL'; return e; }

function parseArgs(argv) {
  const options = { help: false, role: null, vendor: null, requireStructural: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag === '--structural') options.requireStructural = true;
    else if (['--brief', '--role', '--vendor'].includes(flag)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw argumentError(`${flag} requires a value`);
      if (flag === '--brief') options.brief = value;
      if (flag === '--role') options.role = value;
      if (flag === '--vendor') options.vendor = value;
    } else throw argumentError(`Unknown option: ${flag}`);
  }
  if (options.role && !ROLES.includes(options.role)) throw argumentError(`--role must be one of: ${ROLES.join(', ')}`);
  if (options.vendor && !['openai', 'google', 'anthropic'].includes(options.vendor)) throw argumentError('--vendor must be openai, google, or anthropic');
  return options;
}

function markerHolds(marker, text) { return marker.anyOf.some((needle) => text.includes(needle)); }
function scopeIsReal(text) {
  const match = text.match(/SCOPE\s*:\s*([^\r\n]+)/i);
  return Boolean(match && !/[<>]|TODO|TBD|placeholder/i.test(match[1]));
}

function missingMarkers(text, opts = {}) {
  if (typeof text !== 'string') return REQUIRED_MARKERS.map((m) => m.id);
  const missing = REQUIRED_MARKERS.filter((m) => !markerHolds(m, text)).map((m) => m.id);
  if (opts.role === 'implement' && !/\bimplement\b/i.test(text)) missing.push('implement');
  if (opts.role && opts.role !== 'implement' && !/read[- ]only|do not modify|no writes/i.test(text)) missing.push('read-only role');
  if (opts.requireStructural) {
    for (const marker of STRICT_MARKERS) if (!markerHolds(marker, text)) missing.push(marker.id);
    if (!scopeIsReal(text)) missing.push('real SCOPE block');
    if (opts.vendor === 'google' && !/casper_via=agy|agy/i.test(text)) missing.push('casper_via=agy');
    if (opts.vendor === 'anthropic' && !/R16|auth.*probe|headless.*probe/i.test(text)) missing.push('Claude R16 probe status');
  }
  return [...new Set(missing)];
}

function checkBriefText(text, opts = {}) {
  const missing = missingMarkers(text, opts);
  return { ok: missing.length === 0, missing };
}

function checkBriefFile(briefPath, opts = {}) {
  const resolved = path.resolve(briefPath);
  let body;
  try { body = fs.readFileSync(resolved, 'utf8'); }
  catch { throw argumentError(`--brief file does not exist: ${resolved}`); }
  const basic = checkBriefText(body, opts);
  const structuralMissing = [];
  if (opts.requireStructural) {
    try { verifyStagedRules(resolved); }
    catch (error) { structuralMissing.push(`staged rules: ${error.message}`); }
  }
  return { ok: basic.ok && structuralMissing.length === 0, missing: [...basic.missing, ...structuralMissing], briefPath: resolved };
}

function formatMissing(missing) { return `brief missing RULES markers: ${missing.join(', ')}`; }

function main(argv = process.argv.slice(2), io = process) {
  try {
    const options = parseArgs(argv);
    if (options.help) { io.stdout.write(`${usage()}\n`); return 0; }
    if (!options.brief) throw argumentError('--brief is required');
    const result = checkBriefFile(options.brief, options);
    if (!result.ok) throw rulesError(formatMissing(result.missing));
    io.stdout.write(`${JSON.stringify({ ok: true, brief: result.briefPath })}\n`);
    return 0;
  } catch (error) {
    const code = error.code || 'RULES_FAIL';
    io.stderr.write(`${code}: ${error.message}\n`);
    return code === 'ARGUMENT_ERROR' ? 2 : 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { REQUIRED_MARKERS, STRICT_MARKERS, RULES_DIR, RULES_INDEX, STANDING_PATH, VENDOR_MD, checkBriefFile, checkBriefText, formatMissing, main, missingMarkers, parseArgs, usage };
