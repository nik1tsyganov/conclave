#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadMatrix } = require('./dispatch-matrix.js');
const { hashFile, writeJson } = require('./dispatch-evidence.js');
const { verifyProbe } = require('./probe-evidence.js');

function load(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
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
  const entry = { available: true, vendor: verified.vendor, requestedModel: verified.requestedModel, observedModel: verified.observedModel, effort: verified.effort, observedAt: verified.completedAt, evidence: { path: file, sha256: hashFile(file) }, note: options.note || null };
  const data = load(options.file);
  data.schemaVersion = 2;
  data.vendors ||= {};
  const vendor = data.vendors[raw.vendor] ||= { models: {} };
  vendor.models ||= {};
  const model = vendor.models[raw.requestedModel] ||= { efforts: {} };
  model.efforts ||= {};
  model.efforts[raw.effort] = entry;
  writeJson(path.resolve(options.file), data);
  return entry;
}
function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') { opts.help = true; continue; }
    if (!['--file', '--probe', '--note'].includes(argv[i]) || !argv[i + 1]) throw new Error(`invalid option: ${argv[i]}`);
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
