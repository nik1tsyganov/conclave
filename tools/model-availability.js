#!/usr/bin/env node
// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const fs = require('node:fs');
const { loadMatrix } = require('./dispatch-matrix.js');
const { assertPlainPath, hashFile, writeJson } = require('./dispatch-evidence.js');
const { verifyProbe } = require('./probe-evidence.js');
const { readJsonFile } = require('./json-file.js');
const { canonicalPlainPath, pathsOverlap } = require('./runtime-paths.js');

function load(file) {
  try { return readJsonFile(file); }
  catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 2, vendors: {} }; throw error; }
}
function record(options) {
  if (!options.file || !options.probe) throw new Error('--file and --probe are required; handwritten observations are not evidence');
  const file = fs.realpathSync(options.probe);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const matrix = loadMatrix();
  const spec = matrix.vendors?.[raw.vendor]?.models?.[raw.requestedModel];
  if (!spec?.efforts.includes(raw.effort)) throw new Error('probe model/effort is outside catalog');
  const verified = verifyProbe(file, { vendor: raw.vendor, model: raw.requestedModel, effort: raw.effort, observedModel: spec.canonical || raw.requestedModel });
  const destination = canonicalPlainPath(options.file);
  assertPlainPath(destination);
  if ([file, verified.capture, verified.log].some(evidence => pathsOverlap(destination, canonicalPlainPath(evidence)))) {
    throw new Error('availability output overlaps verified probe evidence');
  }
  const entry = { available: true, vendor: verified.vendor, requestedModel: verified.requestedModel, observedModel: verified.observedModel, effort: verified.effort, observedAt: verified.completedAt, evidence: { path: file, sha256: hashFile(file) }, note: options.note || null };
  const data = load(destination);
  data.schemaVersion = 2;
  data.vendors ||= {};
  const vendor = data.vendors[raw.vendor] ||= { models: {} };
  vendor.models ||= {};
  const model = vendor.models[raw.requestedModel] ||= { efforts: {} };
  model.efforts ||= {};
  model.efforts[raw.effort] = entry;
  writeJson(destination, data);
  return entry;
}
function parseArgs(argv) {
  const opts = {};
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    if (seen.has(argv[i])) throw new Error(`duplicate option: ${argv[i]}`);
    seen.add(argv[i]);
    if (argv[i] === '--help') { opts.help = true; continue; }
    if (!['--file', '--probe', '--note'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`invalid option: ${argv[i]}`);
    opts[argv[i].slice(2)] = argv[++i];
  }
  return opts;
}
function main(argv = process.argv.slice(2), io = process) {
  try {
    const opts = parseArgs(argv);
    if (opts.help) { io.stdout.write('Usage: model-availability --file <availability.json> --probe <model-probe result.json> [--note <text>]\n'); return 0; }
    io.stdout.write(`${JSON.stringify(record(opts))}\n`); return 0;
  } catch (error) { io.stderr.write(`AVAILABILITY_FAIL: ${error.message}\n`); return 1; }
}
if (require.main === module) process.exitCode = main();
module.exports = { load, main, parseArgs, record };
