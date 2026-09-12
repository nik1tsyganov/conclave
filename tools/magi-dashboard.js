#!/usr/bin/env node
'use strict';

// Optional observer. Do not import runners, finalizers, or proof/approval validators here.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { canonicalPlainPath } = require('./runtime-paths.js');

const LIMITS = Object.freeze({ fileBytes: 1024 * 1024, totalBytes: 32 * 1024 * 1024, dispatches: 256, events: 2048, edges: 4096 });
const STATES = new Set(['RUNNING', 'PASS', 'FAIL', 'AWAITING_ATTESTATION', 'NOT_RUN']);
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const ASSETS = Object.freeze({ '/': ['dashboard.html', 'text/html; charset=utf-8'], '/dashboard.css': ['dashboard.css', 'text/css; charset=utf-8'], '/dashboard.js': ['dashboard.js', 'text/javascript; charset=utf-8'] });
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length <= 160 && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
const timestamp = value => typeof value === 'string' && value.length <= 35 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
const newest = values => values.filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
const keyFor = entry => digest(JSON.stringify([entry.dispatchId, entry.unitId, entry.role]));
function fail(message) { throw new Error(message); }
function within(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Reuse the runtime's lexical/ancestor guard, and add hard-link and bounded-fd reads.
// No artifact-supplied path is passed to this reader.
function reader(runDir) {
  let root;
  try {
    if (typeof runDir !== 'string' || !runDir.trim() || /^[\\/]{2}/.test(runDir)) fail('Invalid run directory');
    root = canonicalPlainPath(runDir);
    if (!fs.lstatSync(root).isDirectory()) fail('Invalid run directory');
  } catch { fail('Run directory must be an existing plain local directory'); }
  let bytesRead = 0;
  const seen = new Map();
  function bytes(relative, optional = false, remember = true) {
    const file = path.join(root, relative);
    let fd;
    try {
      if (!within(root, file) || canonicalPlainPath(file) !== file) fail('Unsafe path');
      const before = fs.lstatSync(file);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) fail('Nonplain file');
      if (before.size > LIMITS.fileBytes || bytesRead + before.size > LIMITS.totalBytes) fail('File read limit exceeded');
      fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) fail('File changed');
      const buffer = Buffer.alloc(opened.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
        if (!count) break;
        length += count;
      }
      bytesRead += length;
      const after = fs.fstatSync(fd);
      if (length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || canonicalPlainPath(file) !== file) fail('File changed');
      const result = buffer.subarray(0, length);
      if (remember) seen.set(relative, digest(result));
      return result;
    } catch (error) {
      if (error.code === 'ENOENT' && optional) { if (remember) seen.set(relative, null); return null; }
      fail('Run metadata is unreadable, unsafe, changing, or exceeds the read limit');
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  function json(relative, optional = false) {
    const buffer = bytes(relative, optional);
    if (buffer === null) return null;
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
      if (!object(value)) fail('Object required');
      return { value, hash: digest(buffer) };
    } catch { fail('Run metadata is malformed or incomplete'); }
  }
  function unchanged() {
    for (const [relative, hash] of seen) {
      const current = bytes(relative, hash === null, false);
      if ((current === null ? null : digest(current)) !== hash) fail('Run metadata changed during observation; retry');
    }
  }
  return { root, bytes, json, unchanged };
}

function createSnapshot(runDir, { nowMs = Date.now() } = {}) {
  const observedAt = new Date(nowMs).toISOString();
  const read = reader(runDir);
  const planned = read.json('dispatch-plan.json');
  const sealed = read.json('plan-seal.json');
  const plan = planned.value, seal = sealed.value;
  if (!ID.test(plan.planId || '') || !Array.isArray(plan.dispatches) || !plan.dispatches.length || plan.dispatches.length > LIMITS.dispatches) fail('Run plan is invalid or exceeds the dispatch limit');
  if (plan.dispatches.some(entry => !object(entry) || !ID.test(entry.dispatchId || '') || entry.dispatchId === 'arbiter' || !ID.test(entry.unitId || '') || !['role', 'vendor', 'model', 'effort', 'class'].every(field => text(entry[field])))) fail('Run dispatch identities are invalid');
  const ids = new Set(plan.dispatches.map(entry => entry.dispatchId));
  if (ids.size !== plan.dispatches.length) fail('Run dispatch identities are duplicated');
  const warnings = ['Observer only: recorded execution markers are not revalidated acceptance or current process liveness.'];
  const warn = message => { if (!warnings.includes(message)) warnings.push(message); };
  const bound = [1, 2].includes(seal.schemaVersion) && seal.planId === plan.planId && seal.planHash === planned.hash && Boolean(timestamp(seal.sealedAt)) && Date.parse(seal.sealedAt) <= nowMs;
  if (!bound) warn('Plan seal is missing, invalid, or does not match current plan bytes.');
  const events = [], edges = [], dispatches = [];
  function event(dispatch, attempt, kind, at, status, summary, source) {
    if (!at) return;
    events.push({ id: `${dispatch.id}:${attempt}:${kind}`, at, dispatchId: dispatch.id, vendor: dispatch.vendor, kind, status, summary, source });
  }
  function edge(from, to, kind, label, observed, metadata = {}) {
    const id = `${kind}:${from}:${to}${metadata.attemptNumber === undefined ? '' : `:${metadata.attemptNumber}`}`;
    if (edges.some(row => row.id === id)) return;
    if (edges.length >= LIMITS.edges) fail('Run graph exceeds the edge limit');
    edges.push({ id, from, to, kind, label, observed, ...metadata });
  }
  function observe(entry, dispatch, relative, evidenceRelative, number) {
    const record = read.json(relative, true);
    if (!record) return null;
    const state = record.value;
    const startedAt = timestamp(state.startedAt), completedAt = timestamp(state.completedAt);
    const identity = bound && state.schemaVersion === 1 && state.planId === plan.planId && state.planHash === seal.planHash && isDeepStrictEqual(state.entry, entry) && state.requestHash === digest(JSON.stringify({ planHash: seal.planHash, entry }));
    const expectedDir = path.join(read.root, evidenceRelative);
    let allowedEvidence = false;
    // Reject network/device paths before lookup. Compare plain identities because
    // Windows producers can retain case or 8.3 aliases that native realpath expands.
    if (typeof state.evidenceDir === 'string' && !/^[\\/]{2}/.test(state.evidenceDir) && path.isAbsolute(state.evidenceDir) && !state.evidenceDir.split(/[\\/]/).some(part => part === '.' || part === '..')) {
      try { allowedEvidence = canonicalPlainPath(state.evidenceDir) === canonicalPlainPath(expectedDir); }
      catch { /* Nonplain or unreadable evidence paths remain untrusted. */ }
    }
    let status = identity && allowedEvidence && startedAt && STATES.has(state.status) ? state.status : 'UNKNOWN';
    let issue = !identity ? 'UNBOUND_TRANSACTION' : !allowedEvidence ? 'UNTRUSTED_EVIDENCE_PATH' : status === 'UNKNOWN' ? 'INCOMPLETE_TRANSACTION' : null;
    const receipt = object(state.receipt) ? state.receipt : null;
    const proofId = receipt && HASH.test(receipt.proofId || '') ? receipt.proofId : null;
    if (['PASS', 'AWAITING_ATTESTATION'].includes(status) && (!completedAt || !proofId || !object(state.telemetry) || state.telemetry.status !== status || state.telemetry.proofId !== proofId || state.telemetry.dispatchId !== entry.dispatchId || state.telemetry.planHash !== seal.planHash || receipt.status !== status || receipt.dispatchId !== entry.dispatchId || receipt.planHash !== seal.planHash || !Array.isArray(state.artifacts) || !state.artifacts.length)) { status = 'UNKNOWN'; issue = 'INCOMPLETE_TRANSACTION'; }
    if (completedAt && startedAt && Date.parse(completedAt) < Date.parse(startedAt)) { status = 'UNKNOWN'; issue = 'INVALID_TIMESTAMPS'; }
    if ([startedAt, completedAt].some(at => at && Date.parse(at) > nowMs)) { status = 'UNKNOWN'; issue = 'FUTURE_TIMESTAMP'; }
    if (status === 'FAIL') issue = text(state.code) || 'RECORDED_FAILURE';
    const attempt = { id: `${dispatch.id}:${number}`, number, status, startedAt, completedAt, lastEventAt: newest([startedAt, completedAt]), proofId, issue };
    event(dispatch, number, 'reserved', startedAt, status === 'UNKNOWN' ? 'UNKNOWN' : 'RUNNING', 'Dispatch reservation recorded; child liveness is unknown', relative);
    if (allowedEvidence && identity) {
      const launch = read.json(`${evidenceRelative}/launch.json`, true)?.value;
      if (!launch && ['PASS', 'AWAITING_ATTESTATION'].includes(attempt.status)) { attempt.status = 'UNKNOWN'; attempt.issue = 'INCOMPLETE_LAUNCH'; }
      if (launch) {
        const at = timestamp(launch.startedAt);
        const launchBound = launch.planId === plan.planId && launch.planHash === seal.planHash && isDeepStrictEqual(launch.planEntry, entry) && at && at === startedAt && Date.parse(at) <= nowMs;
        if (!launchBound) { attempt.status = 'UNKNOWN'; attempt.issue = 'UNBOUND_LAUNCH'; }
        else {
          event(dispatch, number, 'launch', at, 'RUNNING', 'Native launch metadata recorded', `${evidenceRelative}/launch.json`);
          edge('arbiter', dispatch.id, 'dispatch', 'Observed launch', true);
          if (launch.prerequisites !== undefined && (!Array.isArray(launch.prerequisites) || launch.prerequisites.length > LIMITS.dispatches)) fail('Launch prerequisites are invalid or exceed the limit');
          for (const prior of launch.prerequisites || []) {
            if (object(prior) && ids.has(prior.dispatchId) && prior.dispatchId !== dispatch.id && HASH.test(prior.proofId || '') && HASH.test(prior.transactionSha256 || '')) {
              // These are upstream references saved by the producer, not fresh proof validation
              // or evidence of direct peer transport. Keep each consumer attempt distinct.
              edge(prior.dispatchId, dispatch.id, 'prerequisite', 'Bound prerequisite recorded at launch', true, {
                at, source: `${evidenceRelative}/launch.json`, proofId: prior.proofId, transactionSha256: prior.transactionSha256,
                attemptId: attempt.id, attemptNumber: number,
              });
            } else { attempt.status = 'UNKNOWN'; attempt.issue = 'INVALID_PREREQUISITE'; }
          }
        }
      }
      const processResult = read.json(`${evidenceRelative}/process-result.json`, true)?.value;
      if (['PASS', 'AWAITING_ATTESTATION'].includes(attempt.status) && (!processResult || processResult.ok !== true || processResult.exitCode !== 0 || processResult.exitConfirmed !== true || processResult.lifetime?.exitConfirmed !== true || processResult.lifetime?.exitEvidence !== 'child-close-event' || !timestamp(processResult.lifetime?.endedAt))) { attempt.status = 'UNKNOWN'; attempt.issue = 'INCOMPLETE_CHILD_EXIT'; }
      if (processResult) {
        const at = timestamp(processResult.lifetime?.endedAt);
        const confirmed = processResult.exitConfirmed === true && processResult.lifetime?.exitConfirmed === true && processResult.lifetime?.exitEvidence === 'child-close-event';
        event(dispatch, number, 'child_close', at, confirmed ? (processResult.ok === true && processResult.exitCode === 0 ? 'COMPLETED' : 'FAIL') : 'UNKNOWN', confirmed ? 'Child close recorded; this is not dispatch acceptance' : 'Child exit remains unconfirmed', `${evidenceRelative}/process-result.json`);
        attempt.lastEventAt = newest([attempt.lastEventAt, at]);
      }
      const proof = read.json(`${evidenceRelative}/proof.json`, true)?.value;
      if (['PASS', 'AWAITING_ATTESTATION'].includes(attempt.status) && (!proof || proof.proofId !== proofId)) { attempt.status = 'UNKNOWN'; attempt.issue = 'INCOMPLETE_PROOF'; }
      const checkpoint = read.json(`${evidenceRelative}/checkpoint.json`, true)?.value;
      if (checkpoint) {
        const at = timestamp(checkpoint.recordedAt);
        const valid = checkpoint.planId === plan.planId && checkpoint.planHash === seal.planHash && checkpoint.dispatchId === dispatch.id && checkpoint.status === 'AWAITING_ATTESTATION' && at;
        if (!valid) { attempt.status = 'UNKNOWN'; attempt.issue = 'UNBOUND_CHECKPOINT'; }
        event(dispatch, number, 'checkpoint', at, valid ? 'AWAITING_ATTESTATION' : 'UNKNOWN', 'Post-run checkpoint recorded', `${evidenceRelative}/checkpoint.json`);
        attempt.lastEventAt = newest([attempt.lastEventAt, at]);
      }
      const attestation = read.json(`${evidenceRelative}/attestation.json`, true)?.value;
      if (attestation) {
        const at = timestamp(attestation.acceptedAt);
        const valid = attestation.planId === plan.planId && attestation.planHash === seal.planHash && attestation.dispatchId === dispatch.id && attestation.decision === 'ON_TOPIC' && at;
        if (!valid) { attempt.status = 'UNKNOWN'; attempt.issue = 'UNBOUND_ATTESTATION'; }
        event(dispatch, number, 'attestation', at, valid ? 'RECORDED' : 'UNKNOWN', 'On-topic attestation recorded; this is not an approval vote', `${evidenceRelative}/attestation.json`);
        attempt.lastEventAt = newest([attempt.lastEventAt, at]);
      }
    }
    if (attempt.lastEventAt && Date.parse(attempt.lastEventAt) > nowMs) { attempt.status = 'UNKNOWN'; attempt.issue = 'FUTURE_TIMESTAMP'; }
    if (completedAt) {
      event(dispatch, number, 'transaction', completedAt, attempt.status, 'Transaction result recorded', relative);
      edge(dispatch.id, 'arbiter', 'result', 'Recorded transaction result', true);
    }
    if (attempt.issue && attempt.status === 'UNKNOWN') warn(`${dispatch.id}: ${attempt.issue}.`);
    return attempt;
  }
  for (const entry of plan.dispatches) {
    const dispatch = { id: entry.dispatchId, unitId: entry.unitId, vendor: text(entry.vendor), model: text(entry.model), effort: text(entry.effort), role: text(entry.role), taskClass: text(entry.class), status: bound ? 'NOT_STARTED' : 'UNKNOWN', startedAt: null, completedAt: null, lastEventAt: null, proofId: null, vote: null, issue: null, attempts: [] };
    const key = keyFor(entry);
    const original = observe(entry, dispatch, `.magi-dispatches/${key}.json`, `out/${entry.dispatchId}`, 0);
    if (original) { dispatch.attempts.push(original); for (const name of ['status', 'startedAt', 'completedAt', 'lastEventAt', 'proofId', 'issue']) dispatch[name] = original[name]; }
    for (let number = 1; number <= 2; number += 1) {
      const recovery = `.magi-recoveries/${key}${number === 2 ? '.2' : ''}`;
      const attempt = observe(entry, dispatch, `${recovery}/transaction.json`, `${recovery}/attempt/out/${entry.dispatchId}`, number);
      if (attempt) {
        dispatch.attempts.push(attempt);
        dispatch.lastEventAt = newest([dispatch.lastEventAt, attempt.lastEventAt]);
        dispatch.issue = 'RECOVERY_LINEAGE_UNVERIFIED';
        warn(`${dispatch.id}: recovery attempts are shown separately; replacement acceptance is not inferred.`);
      }
    }
    if (['RUNNING', 'AWAITING_ATTESTATION'].includes(dispatch.status) && dispatch.lastEventAt && nowMs - Date.parse(dispatch.lastEventAt) > 5 * 60 * 1000) warn(`${dispatch.id}: no recorded metadata event for over five minutes; process liveness is unknown.`);
    dispatches.push(dispatch);
    const priors = plan.dispatches.filter(prior => prior.unitId === entry.unitId && ((entry.role === 'verify' && prior.role === 'implement') || (entry.role === 'review' && ['implement', 'verify'].includes(prior.role))));
    for (const prior of priors) edge(prior.dispatchId, entry.dispatchId, 'planned_dependency', 'Planned role order', false);
    if (entry.evidenceReadDirs !== undefined && (!Array.isArray(entry.evidenceReadDirs) || entry.evidenceReadDirs.length > LIMITS.dispatches)) fail('Planned evidence references are invalid or exceed the limit');
    for (const reference of entry.evidenceReadDirs || []) {
      // Compare strings only. External evidence paths are never opened.
      const prior = plan.dispatches.find(candidate => typeof reference === 'string' && path.resolve(reference) === path.join(read.root, 'out', candidate.dispatchId));
      if (prior && prior.dispatchId !== entry.dispatchId) edge(prior.dispatchId, entry.dispatchId, 'planned_dependency', 'Planned evidence dependency', false);
    }
  }
  let approvalStatus = 'UNKNOWN';
  const summary = read.json('run-summary.json', true)?.value;
  const latest = newest(dispatches.map(row => row.lastEventAt));
  const unitIds = new Set(dispatches.map(row => row.unitId));
  const completeUnits = summary && Array.isArray(summary.units) && summary.units.length === unitIds.size && summary.units.every(unit => object(unit) && unitIds.has(unit.unitId) && ['PASS', 'FAIL', 'NOT_REQUIRED'].includes(unit.status)) && new Set(summary.units.map(unit => unit.unitId)).size === unitIds.size;
  // Check consistency inside the saved summary; this does not reassess evidence or votes.
  const savedExecution = Array.isArray(summary?.outcomes) && summary.outcomes.every(row => row?.status === 'PASS') ? 'PASS' : 'FAIL';
  const savedApproval = completeUnits ? (summary.units.some(unit => unit.status === 'FAIL') ? 'FAIL' : summary.units.every(unit => unit.status === 'NOT_REQUIRED') ? 'NOT_REQUIRED' : 'PASS') : null;
  const consistentSummary = summary && summary.executionStatus === savedExecution && summary.approvalStatus === savedApproval && summary.ok === (savedExecution === 'PASS' && savedApproval !== 'FAIL');
  const summaryBound = summary && bound && completeUnits && consistentSummary && summary.schemaVersion === 1 && summary.planId === plan.planId && summary.planHash === seal.planHash && timestamp(summary.finalizedAt) && Date.parse(summary.finalizedAt) >= Date.parse(seal.sealedAt) && Date.parse(summary.finalizedAt) <= nowMs && (!latest || Date.parse(summary.finalizedAt) >= Date.parse(latest)) && Array.isArray(summary.outcomes) && summary.outcomes.length === dispatches.length && dispatches.every(row => {
    const matches = summary.outcomes.filter(outcome => outcome?.dispatchId === row.id && outcome.unitId === row.unitId && outcome.role === row.role && outcome.vendor === row.vendor && outcome.planId === plan.planId && outcome.planHash === seal.planHash);
    return matches.length === 1 && matches[0].status === (row.status === 'NOT_STARTED' ? 'NOT_RUN' : row.status) && !['UNKNOWN', 'RUNNING', 'AWAITING_ATTESTATION'].includes(row.status) && row.attempts.length < 2;
  });
  if (summaryBound) {
    if (['PASS', 'FAIL', 'NOT_REQUIRED'].includes(summary.approvalStatus)) approvalStatus = `RECORDED_${summary.approvalStatus}`;
    for (const row of dispatches) if (row.status === 'NOT_STARTED') row.status = 'NOT_RUN';
    events.push({ id: 'run:finalized', at: summary.finalizedAt, dispatchId: null, vendor: null, kind: 'finalization', status: approvalStatus, summary: 'Recorded finalization; current approval was not rechecked', source: 'run-summary.json' });
  } else if (summary) warn('Recorded run summary is stale, incomplete, or disagrees with observed transactions; approval is unknown.');
  let executionStatus = 'UNKNOWN';
  if (bound && !dispatches.some(row => row.status === 'UNKNOWN' || row.issue === 'RECOVERY_LINEAGE_UNVERIFIED')) {
    if (dispatches.some(row => row.status === 'FAIL')) executionStatus = 'FAIL';
    else if (dispatches.some(row => row.status === 'RUNNING')) executionStatus = 'RUNNING';
    else if (dispatches.some(row => row.status === 'AWAITING_ATTESTATION')) executionStatus = 'AWAITING_ATTESTATION';
    else if (dispatches.every(row => row.status === 'PASS')) executionStatus = 'PASS';
    else executionStatus = dispatches.some(row => row.status === 'NOT_RUN') ? 'NOT_RUN' : 'NOT_STARTED';
  }
  if (events.length > LIMITS.events) { events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)); events.length = LIMITS.events; warn('Older events omitted at the event limit.'); }
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  read.unchanged();
  return { schemaVersion: 1, observedAt, run: { id: plan.planId, mode: text(plan.hostMode), planHash: HASH.test(seal.planHash || '') ? seal.planHash : null, sealedAt: timestamp(seal.sealedAt), executionStatus, approvalStatus, warnings }, dispatches, events, edges };
}

async function startServer({ runDir, port = 0 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail('Port must be an integer from 0 to 65535');
  const root = reader(runDir).root; // Pin the explicit root before opening a listener.
  const token = crypto.randomBytes(32).toString('base64url');
  let origin;
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const error = (status, message) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify({ error: message })); };
    const count = name => request.rawHeaders.filter((_, i) => i % 2 === 0 && request.rawHeaders[i].toLowerCase() === name).length;
    if (count('host') !== 1 || request.headers.host !== origin.slice(7)) return error(403, 'Invalid host');
    if (count('origin') > 1 || (request.headers.origin !== undefined && request.headers.origin !== origin) || (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site']))) return error(403, 'Cross-site requests are forbidden');
    if (request.method !== 'GET') return error(405, 'Only GET is supported');
    if (request.headers['transfer-encoding'] || (request.headers['content-length'] && request.headers['content-length'] !== '0')) return error(400, 'Request bodies are forbidden');
    if (request.url === '/api/snapshot') {
      const supplied = request.headers.authorization;
      const expected = `Bearer ${token}`;
      if (count('authorization') !== 1 || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return error(401, 'A dashboard capability is required');
      try {
        const snapshot = createSnapshot(root);
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(snapshot));
      } catch { error(503, 'Run metadata is unavailable, incomplete, unsafe, or changing. Retry after checking the run files.'); }
      return;
    }
    if (!Object.hasOwn(ASSETS, request.url)) return error(404, 'Not found');
    try {
      const [name, type] = ASSETS[request.url];
      // Keep asset selection fixed; never use request paths on disk.
      const content = reader(__dirname).bytes(name);
      response.writeHead(200, { 'Content-Type': type }); response.end(content);
    } catch { error(503, 'Dashboard asset is unavailable'); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 3000;
  server.maxRequestsPerSocket = 100;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port }, resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, token, origin, url: `${origin}/#token=${token}` };
}

function parseArgs(argv) {
  const options = { port: 0 };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i], value = argv[i + 1];
    if (!['--run-dir', '--port'].includes(flag) || seen.has(flag) || !value || value.startsWith('--')) fail('Usage: node tools/magi-dashboard.js --run-dir <directory> [--port <0-65535>]');
    seen.add(flag);
    if (flag === '--run-dir') options.runDir = value;
    else { if (!/^\d{1,5}$/.test(value) || Number(value) > 65535) fail('Port must be an integer from 0 to 65535'); options.port = Number(value); }
  }
  if (!options.runDir) fail('--run-dir is required');
  return options;
}

async function main(argv = process.argv.slice(2)) {
  try {
    const dashboard = await startServer(parseArgs(argv));
    process.stdout.write(`MAGI read-only dashboard: ${dashboard.url}\n`);
    return dashboard;
  } catch (error) { process.stderr.write(`DASHBOARD_FAIL: ${error.message}\n`); process.exitCode = 1; return null; }
}

module.exports = { LIMITS, createSnapshot, startServer, parseArgs, main };
if (require.main === module) void main();
