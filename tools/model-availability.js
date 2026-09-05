#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VENDORS = new Set(['openai', 'anthropic', 'google']);

function argError(message) { const e = new Error(message); e.code = 'ARGUMENT_ERROR'; return e; }

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') { out.help = true; continue; }
    if (!['--file', '--vendor', '--model', '--observed-model', '--proof-id', '--note'].includes(flag)) throw argError(`unknown option: ${flag}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw argError(`${flag} requires a value`);
    out[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return out;
}

function load(file) {
  try { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, vendors: {} };
    throw argError(`cannot read availability file: ${error.message}`);
  }
}

function record(options) {
  for (const key of ['file', 'vendor', 'model', 'observedModel', 'proofId']) if (!options[key]) throw argError(`--${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)} is required`);
  if (!VENDORS.has(options.vendor)) throw argError('invalid --vendor');
  const data = load(options.file);
  data.schemaVersion = 1;
  data.updatedAt = new Date().toISOString();
  data.vendors ||= {};
  data.vendors[options.vendor] ||= { models: {} };
  data.vendors[options.vendor].models ||= {};
  data.vendors[options.vendor].models[options.model] = {
    available: options.observedModel === options.model,
    observedModel: options.observedModel,
    proofId: options.proofId,
    observedAt: data.updatedAt,
    note: options.note || null,
  };
  fs.mkdirSync(path.dirname(path.resolve(options.file)), { recursive: true });
  fs.writeFileSync(path.resolve(options.file), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return data.vendors[options.vendor].models[options.model];
}

function usage() {
  return 'Usage: node tools/model-availability.js --file <availability.json> --vendor <vendor> --model <requested> --observed-model <actual> --proof-id <proof> [--note <text>]';
}

function main(argv = process.argv.slice(2), io = process) {
  try {
    const opts = parseArgs(argv);
    if (opts.help) { io.stdout.write(`${usage()}\n`); return 0; }
    const result = record(opts);
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return result.available ? 0 : 1;
  } catch (error) {
    const code = error.code || 'AVAILABILITY_FAIL';
    io.stderr.write(`${code}: ${error.message}\n`);
    return code === 'ARGUMENT_ERROR' ? 2 : 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { load, main, parseArgs, record };
