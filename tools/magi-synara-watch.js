#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn']);

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function walkTransactions(root, depth = 0, found = []) {
  if (depth > 12) return found;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return found; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.magi-dispatches') {
        let files;
        try { files = fs.readdirSync(full); } catch { continue; }
        for (const name of files) {
          if (name.endsWith('.json')) found.push(path.join(full, name));
        }
        continue;
      }
      if (!SKIP_DIRS.has(entry.name)) walkTransactions(full, depth + 1, found);
    }
  }
  return found;
}

function inspectTransaction(file) {
  let tx;
  try { tx = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
  if (!tx || tx.status !== 'RUNNING') return null;
  const evidenceDir = typeof tx.evidenceDir === 'string' ? tx.evidenceDir : '';
  const pidFile = evidenceDir ? path.join(evidenceDir, 'child.pid') : '';
  let pid = null;
  if (pidFile && fs.existsSync(pidFile)) {
    const text = fs.readFileSync(pidFile, 'utf8').trim();
    const parsed = Number.parseInt(text, 10);
    pid = Number.isInteger(parsed) ? parsed : null;
  }
  if (pidAlive(pid)) return null;
  return {
    kind: 'dead-running',
    path: file,
    dispatchId: tx.entry?.dispatchId || tx.dispatchId || null,
    evidenceDir: evidenceDir || null,
    pid,
    note: 'RUNNING transaction whose child.pid is missing or dead. Notify only; never rewrite the receipt to PASS.',
  };
}

function inspectHooks(file) {
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
    return { kind: 'hooks-missing', path: file, note: 'synara-capture hooks.json is missing; MAGI Google isolation cannot be confirmed.' };
  }
  const text = fs.readFileSync(file, 'utf8');
  if (/"decision"\s*:\s*"ask"/.test(text) || /\\"decision\\":\\"ask\\"/.test(text)) {
    return { kind: 'hooks-ask', path: file, note: 'synara-capture PreToolUse emits ask; MAGI Google instruction reads will fail.' };
  }
  return null;
}

function parseArgs(argv) {
  const runRoots = [];
  const hooks = [];
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--run-roots' || flag === '--hooks') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
      if (flag === '--run-roots') runRoots.push(path.resolve(value));
      else hooks.push(path.resolve(value));
      continue;
    }
    throw new Error(`unknown option: ${flag}`);
  }
  if (!runRoots.length && !hooks.length) {
    throw new Error('Usage: magi-synara-watch --run-roots <dir> [--run-roots <dir>...] [--hooks <hooks.json>...]');
  }
  return { runRoots, hooks };
}

function watch(opts) {
  const findings = [];
  for (const root of opts.runRoots) {
    if (!fs.existsSync(root)) {
      findings.push({ kind: 'run-root-missing', path: root, note: 'MAGI run root does not exist.' });
      continue;
    }
    for (const file of walkTransactions(root)) {
      const finding = inspectTransaction(file);
      if (finding) findings.push(finding);
    }
  }
  for (const file of opts.hooks) {
    const finding = inspectHooks(file);
    if (finding) findings.push(finding);
  }
  return { notify: findings.length > 0, findings };
}

function main(argv = process.argv.slice(2)) {
  try {
    const result = watch(parseArgs(argv));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`MAGI_SYNARA_WATCH_FAIL: ${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { inspectHooks, inspectTransaction, main, pidAlive, watch };
