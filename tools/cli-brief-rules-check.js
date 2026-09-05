#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { verifyStagedRules } = require('./cli-rules-stage.js');
const { verifySeatSkills } = require('./cli-skill-stage.js');
const { loadProfiles, validateSeat } = require('./seat-policy.js');
const { ROLES } = require('./dispatch-schema.js');
const { canonicalPlainPath } = require('./runtime-paths.js');

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
    if (opts.vendor === 'google' && !/\bcasper_via=agy\b/.test(text)) missing.push('casper_via=agy');
    if (opts.vendor === 'anthropic' && !/R16|auth.*probe|headless.*probe/i.test(text)) missing.push('Claude R16 probe status');
  }
  return [...new Set(missing)];
}

function checkBriefText(text, opts = {}) {
  const missing = missingMarkers(text, opts);
  return { ok: missing.length === 0, missing };
}

function readRegularFile(file) {
  if (!fs.lstatSync(file).isFile()) throw new Error(`not a regular file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function verifyStagedSeat(briefPath, opts = {}) {
  const briefDir = path.dirname(path.resolve(briefPath));
  const seatContractPath = path.resolve(opts.seatContractPath || path.join(briefDir, 'SEAT-CONTRACT.md'));
  const profilePath = path.join(path.dirname(seatContractPath), 'seat-profile.json');
  const onDiskProfile = JSON.parse(readRegularFile(profilePath));
  const profile = opts.seatProfile || onDiskProfile;
  if (!isDeepStrictEqual(onDiskProfile, profile)) throw new Error('generated seat profile differs from the expected profile');
  for (const field of ['role', 'vendor']) {
    if (opts[field] && profile[field] !== opts[field]) throw new Error(`seat ${field} does not match the requested ${field}`);
  }
  if (!Array.isArray(profile.skills)) throw new Error('seat profile has no skill allow-list');
  const validated = validateSeat(loadProfiles(), profile);
  if (profile.permissionProfile !== validated.permissionProfile) throw new Error('seat permission profile does not match role policy');
  if (!isDeepStrictEqual(profile.proofFields, validated.proofFields)) throw new Error('seat proof fields do not match vendor policy');

  // Staging writes canonical pointers, including the long name of Windows
  // 8.3 paths. Compare against that same root without accepting junctions.
  const skillRoot = canonicalPlainPath(opts.skillRoot || path.join(path.dirname(seatContractPath), 'skills'));
  const contract = readRegularFile(seatContractPath);
  for (const [label, value] of Object.entries({
    Vendor: profile.vendor, Role: profile.role, Class: profile.class, 'Permission profile': profile.permissionProfile,
    'Skill manifest': path.join(skillRoot, 'skills-manifest.json'),
  })) {
    const fields = contract.split(/\r?\n/).filter((line) => line.startsWith(`${label}:`));
    if (fields.length !== 1 || fields[0].slice(label.length + 1).trim() !== value) {
      throw new Error(`seat contract ${label} does not match the generated profile`);
    }
  }
  const skillSection = contract.match(/^Allowed staged skills:\r?\n((?:- [^\r\n]+(?:\r?\n|$))*)/m);
  const pointers = skillSection ? skillSection[1].trimEnd().split(/\r?\n/).sort() : [];
  const expectedPointers = validated.skills.map((skill) => `- ${skill}: ${path.join(skillRoot, skill, 'SKILL.md')}`).sort();
  if (!isDeepStrictEqual(pointers, expectedPointers)) throw new Error('seat contract skill pointers do not match the staged allow-list');
  const manifest = opts.expectedSkillsManifest || JSON.parse(readRegularFile(path.join(skillRoot, 'skills-manifest.json')));
  verifySeatSkills({ destinationRoot: skillRoot, skills: validated.skills, manifest });
  return { seatProfile: validated, skillRoot, seatContractPath };
}

function checkBriefFile(briefPath, opts = {}) {
  const resolved = path.resolve(briefPath);
  let body;
  try { body = fs.readFileSync(resolved, 'utf8'); }
  catch { throw argumentError(`--brief file does not exist: ${resolved}`); }
  const basic = checkBriefText(body, opts);
  const structuralMissing = [];
  if (opts.requireStructural) {
    try { verifyStagedRules(resolved, opts.expectedRulesManifest); }
    catch (error) { structuralMissing.push(`staged rules: ${error.message}`); }
    try {
      const staged = verifyStagedSeat(resolved, opts);
      const roleCheck = checkBriefText(body, { ...opts, role: staged.seatProfile.role, vendor: staged.seatProfile.vendor });
      for (const item of roleCheck.missing) if (!basic.missing.includes(item)) structuralMissing.push(item);
    }
    catch (error) { structuralMissing.push(`staged seat: ${error.message}`); }
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
module.exports = { REQUIRED_MARKERS, STRICT_MARKERS, RULES_DIR, RULES_INDEX, STANDING_PATH, VENDOR_MD, checkBriefFile, checkBriefText, formatMissing, main, missingMarkers, parseArgs, usage, verifyStagedSeat };
