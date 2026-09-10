#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { writeJson } = require('./dispatch-evidence.js');

const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn']);
const TERMINAL = new Set(['PASS', 'FAIL', 'AWAITING_ATTESTATION']);
const JOIN_KIND = 'magi-dispatch-join';

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readPid(file) {
  if (!file || !fs.existsSync(file)) return null;
  const parsed = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function walkNamed(root, matchName, depth = 0, found = []) {
  if (depth > 12) return found;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return found; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkNamed(full, matchName, depth + 1, found);
      continue;
    }
    if (entry.isFile() && entry.name === matchName) found.push(full);
  }
  return found;
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

function readTransaction(file) {
  let tx;
  try { tx = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
  if (!tx || typeof tx !== 'object') return null;
  const evidenceDir = typeof tx.evidenceDir === 'string' ? tx.evidenceDir : '';
  const pid = readPid(evidenceDir ? path.join(evidenceDir, 'child.pid') : '');
  return {
    file,
    dispatchId: tx.entry?.dispatchId || tx.dispatchId || null,
    status: tx.status || 'UNKNOWN',
    evidenceDir: evidenceDir || null,
    pid,
    childAlive: pidAlive(pid),
  };
}

function inspectTransaction(file) {
  const row = readTransaction(file);
  if (!row || row.status !== 'RUNNING' || row.childAlive) return null;
  return {
    kind: 'dead-running',
    path: file,
    dispatchId: row.dispatchId,
    evidenceDir: row.evidenceDir,
    pid: row.pid,
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

function collectTargets(runDir, dispatchIds) {
  const rows = walkTransactions(runDir).map(readTransaction).filter(Boolean);
  if (!dispatchIds.length) return rows;
  return dispatchIds.map((dispatchId) => (
    rows.find((row) => row.dispatchId === dispatchId) || { file: null, dispatchId, status: 'MISSING', evidenceDir: null, pid: null, childAlive: false }
  ));
}

function writeJoinManifest({ runDir, dispatchIds, out, parentPid }) {
  if (!runDir) throw new Error('--run-dir is required');
  const root = path.resolve(runDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('run directory must exist');
  const dest = path.resolve(out || path.join(root, 'join-manifest.json'));
  const rows = collectTargets(root, dispatchIds);
  const manifest = {
    schemaVersion: 1,
    kind: JOIN_KIND,
    synaraWaitJoins: false,
    runDir: root,
    dispatchIds: dispatchIds.length ? dispatchIds : rows.map((row) => row.dispatchId).filter(Boolean),
    parentPid: parentPid ?? null,
    recordedAt: new Date().toISOString(),
    dispatches: rows.map((row) => ({
      dispatchId: row.dispatchId,
      status: row.status,
      transactionPath: row.file,
      childPid: row.pid,
    })),
    note: 'Joins MAGI dispatch-run transactions only. synara_wait_for_threads does not join these PIDs. Never rewrite a receipt to PASS.',
  };
  writeJson(dest, manifest);
  return manifest;
}

function inspectJoinManifest(file) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }
  if (!manifest || manifest.kind !== JOIN_KIND) return [];
  const findings = [];
  const runDir = manifest.runDir && fs.existsSync(manifest.runDir) ? manifest.runDir : path.dirname(file);
  const ids = Array.isArray(manifest.dispatchIds) ? manifest.dispatchIds : [];
  if (manifest.parentPid && !pidAlive(manifest.parentPid)) {
    const rows = collectTargets(runDir, ids);
    if (rows.some((row) => row.status === 'RUNNING')) {
      findings.push({
        kind: 'join-parent-dead',
        path: file,
        pid: manifest.parentPid,
        note: 'Join-manifest parent PID is dead while a MAGI transaction is still RUNNING. Notify only; never rewrite the receipt to PASS.',
      });
    }
  }
  for (const row of collectTargets(runDir, ids)) {
    if (row.status === 'RUNNING' && !row.childAlive) {
      findings.push({
        kind: 'join-orphan',
        path: row.file || file,
        dispatchId: row.dispatchId,
        pid: row.pid,
        note: 'Join-manifest dispatch is RUNNING with a missing or dead child.pid. Notify only; never rewrite the receipt to PASS.',
      });
    }
  }
  return findings;
}

function waitForDispatches({ runDir, dispatchIds, timeoutMs, pollMs }) {
  if (!runDir) throw new Error('--run-dir is required');
  if (!Array.isArray(dispatchIds) || !dispatchIds.length) throw new Error('--wait requires --dispatch-id');
  const root = path.resolve(runDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('run directory must exist');
  const started = Date.now();
  while (true) {
    const outcomes = collectTargets(root, dispatchIds);
    const waiting = outcomes.filter((row) => row.status === 'RUNNING' && row.childAlive);
    const missing = outcomes.filter((row) => row.status === 'MISSING');
    const orphans = outcomes.filter((row) => row.status === 'RUNNING' && !row.childAlive);
    const settled = outcomes.filter((row) => TERMINAL.has(row.status));
    if (!waiting.length && !missing.length) {
      return {
        joined: true,
        timedOut: false,
        notify: orphans.length > 0,
        synaraWaitJoins: false,
        waiting,
        missing,
        orphans,
        settled,
        outcomes,
        note: 'Joined MAGI dispatch-run transactions only. Never rewrite a receipt to PASS.',
      };
    }
    if (Date.now() - started >= timeoutMs) {
      return {
        joined: false,
        timedOut: true,
        notify: true,
        synaraWaitJoins: false,
        waiting,
        missing,
        orphans,
        settled,
        outcomes,
        note: 'Join timed out. synara_wait_for_threads does not join these PIDs. Never rewrite a receipt to PASS.',
      };
    }
    sleepMs(pollMs);
  }
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
    for (const file of walkNamed(root, 'join-manifest.json')) {
      findings.push(...inspectJoinManifest(file));
    }
  }
  for (const file of opts.hooks) {
    const finding = inspectHooks(file);
    if (finding) findings.push(finding);
  }
  return { notify: findings.length > 0, findings };
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(argv) {
  const opts = {
    mode: 'scan',
    runRoots: [],
    hooks: [],
    dispatchIds: [],
    runDir: '',
    out: '',
    timeoutMs: 2700000,
    pollMs: 250,
    parentPid: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--wait') { opts.mode = 'wait'; continue; }
    if (flag === '--record-join') { opts.mode = 'record-join'; continue; }
    if (flag === '--run-roots' || flag === '--hooks' || flag === '--run-dir' || flag === '--dispatch-id' || flag === '--out' || flag === '--timeout-ms' || flag === '--poll-ms' || flag === '--parent-pid') {
      const value = takeValue(argv, i, flag);
      i += 1;
      if (flag === '--run-roots') opts.runRoots.push(path.resolve(value));
      else if (flag === '--hooks') opts.hooks.push(path.resolve(value));
      else if (flag === '--run-dir') opts.runDir = path.resolve(value);
      else if (flag === '--dispatch-id') opts.dispatchIds.push(value);
      else if (flag === '--out') opts.out = value;
      else if (flag === '--timeout-ms') opts.timeoutMs = Number(value);
      else if (flag === '--poll-ms') opts.pollMs = Number(value);
      else opts.parentPid = Number(value);
      continue;
    }
    throw new Error(`unknown option: ${flag}`);
  }
  if (opts.mode === 'scan' && !opts.runRoots.length && !opts.hooks.length) {
    throw new Error('Usage: magi-synara-watch --run-roots <dir> [--hooks <hooks.json>...] | --wait --run-dir <sealed-run> [--dispatch-id <id>...] | --record-join --run-dir <sealed-run> [--dispatch-id <id>...]');
  }
  if ((opts.mode === 'wait' || opts.mode === 'record-join') && !opts.runDir) throw new Error('--run-dir is required');
  if (opts.mode === 'wait' && !opts.dispatchIds.length) throw new Error('--wait requires --dispatch-id');
  if (opts.mode === 'wait' && (!Number.isSafeInteger(opts.timeoutMs) || opts.timeoutMs < 1)) throw new Error('--timeout-ms must be a positive integer');
  if (opts.mode === 'wait' && (!Number.isSafeInteger(opts.pollMs) || opts.pollMs < 1)) throw new Error('--poll-ms must be a positive integer');
  if (opts.parentPid !== null && (!Number.isInteger(opts.parentPid) || opts.parentPid <= 0)) throw new Error('--parent-pid must be a positive integer');
  return opts;
}

function main(argv = process.argv.slice(2)) {
  try {
    const opts = parseArgs(argv);
    if (opts.mode === 'record-join') {
      process.stdout.write(`${JSON.stringify(writeJoinManifest(opts))}\n`);
      return 0;
    }
    if (opts.mode === 'wait') {
      const result = waitForDispatches(opts);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return result.joined && !result.notify ? 0 : 1;
    }
    const result = watch(opts);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.notify ? 1 : 0;
  } catch (error) {
    process.stderr.write(`MAGI_SYNARA_WATCH_FAIL: ${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = {
  inspectHooks,
  inspectJoinManifest,
  inspectTransaction,
  main,
  pidAlive,
  waitForDispatches,
  watch,
  writeJoinManifest,
};
