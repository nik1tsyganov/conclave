#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { writeJson } = require('./dispatch-evidence.js');

function validLabel(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copyTree(source, destination, files, prefix = '') {
  const entries = fs.readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`host helper source may not contain symlinks: ${relative}`);
    if (entry.isDirectory()) {
      copyTree(from, to, files, relative);
      continue;
    }
    if (!entry.isFile()) throw new Error(`unsupported host helper entry: ${relative}`);
    fs.copyFileSync(from, to);
    files.push({ path: relative, sha256: hashFile(to) });
  }
}

function stageHelperEvidence({ runDir, label, from }) {
  if (!runDir || !label || !from) throw new Error('--run-dir, --label, and --from are required');
  if (!validLabel(label)) throw new Error('label must be a safe identifier');
  const root = path.resolve(runDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('run directory must exist');
  const source = path.resolve(from);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error('source must be an existing directory');
  const destination = path.join(root, 'host-helpers', label);
  if (fs.existsSync(destination)) throw new Error(`host helper label already exists: ${label}`);
  const files = [];
  copyTree(source, destination, files);
  const manifest = {
    schemaVersion: 1,
    kind: 'host-helper',
    tally: 'never',
    position: false,
    label,
    source,
    destination,
    files,
    note: 'Non-voting Synara/browser helper evidence. Never count as a MAGI POSITION.',
  };
  writeJson(path.join(destination, 'host-helper-manifest.json'), manifest);
  return manifest;
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--run-dir', '--label', '--from'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new Error('Usage: host-helper-evidence --run-dir <sealed run> --label <id> --from <directory>');
    }
    const key = argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (Object.hasOwn(opts, key)) throw new Error(`duplicate option: ${argv[i]}`);
    opts[key] = argv[i + 1];
  }
  return opts;
}

function main(argv = process.argv.slice(2)) {
  try {
    const result = stageHelperEvidence(parseArgs(argv));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`HOST_HELPER_EVIDENCE_FAIL: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { main, stageHelperEvidence };
