#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readSealedRun } = require('./plan-seal.js');
const { assertPlainPath, compareWorkspace, hash, hashFile, inside, snapshotWorkspace, transactionKey, verifyCommittedRow, writeJson } = require('./dispatch-evidence.js');
const { verifyProof } = require('./cli-proof.js');
const { CLAUDE_RESPONSE_PROTOCOL, finalResponse, validateClaudeResponseLaunch } = require('./vendor-native.js');
const { tally } = require('./position-tally.js');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function same(a, b, label) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${label} disagrees with committed evidence`); }
function verifyExecution(run, entry, state) {
  same(state.entry, entry, 'plan entry');
  if (state.planHash !== run.seal.planHash || state.planId !== run.plan.planId || state.requestHash !== hash(JSON.stringify({ planHash: run.seal.planHash, entry }))) throw new Error('transaction belongs to a different plan');
  const transactionPath = path.join(run.root, '.magi-dispatches', `${transactionKey(entry)}.json`);
  if (state.telemetry?.transactionPath !== transactionPath || !inside(state.evidenceDir, run.root)) throw new Error('transaction evidence is outside its sealed run');
  verifyCommittedRow(state.telemetry, { checkLogs: false });
  const artifact = (name) => path.join(state.evidenceDir, name);
  for (const name of ['capture.txt', 'vendor.log', 'proof.json', 'receipt-ack.json', 'handoff-envelope.json', 'scope-audit.json', 'plan-binding.json', 'launch.json', 'workspace-before.json', 'workspace-after.json', 'runtime-manifest.json', 'rules-source-before.json', 'rules-source-after.json', 'rules-source-audit.json', 'skills-source-before.json', 'skills-source-after.json', 'skills-source-audit.json']) {
    if (!state.artifacts.some((item) => item.path === artifact(name) && item.sha256 === hashFile(artifact(name)))) throw new Error(`missing committed artifact: ${name}`);
  }
  const launch = readJson(artifact('launch.json'));
  const responseProtocol = entry.vendor === 'anthropic' ? CLAUDE_RESPONSE_PROTOCOL : undefined;
  if (responseProtocol) validateClaudeResponseLaunch(launch);
  const runtimeSha256 = hash(JSON.stringify(readJson(artifact('runtime-manifest.json'))));
  if (launch.runtimeSha256 !== runtimeSha256 || state.receipt.runtimeSha256 !== runtimeSha256) throw new Error('runtime identity mismatch');
  same(launch.planEntry, entry, 'launch');
  same(readJson(artifact('plan-binding.json')), { planId: run.plan.planId, planHash: run.seal.planHash, entry }, 'binding');
  same(readJson(artifact('receipt-ack.json')), state.receipt, 'receipt');
  const envelope = readJson(artifact('handoff-envelope.json'));
  const { telemetryLog, ...receiptEnvelope } = envelope;
  same(receiptEnvelope, state.receipt, 'handoff');
  const spec = run.matrix.vendors[entry.vendor].models[entry.model];
  const proof = verifyProof({ vendor: entry.vendor, capture: artifact('capture.txt'), log: artifact('vendor.log'), expectedModel: entry.model, expectedObservedModel: spec.canonical || entry.model, expectedEffort: entry.effort, expectedSandbox: entry.vendor === 'openai' ? (entry.role === 'implement' ? 'workspace-write' : 'read-only') : undefined, onTopic: true, responseProtocol });
  Object.assign(proof, { planId: run.plan.planId, planHash: run.seal.planHash, escalation: entry.escalation === true, escalationReason: entry.escalationReason || null });
  const proofId = hash(JSON.stringify(proof));
  same(readJson(artifact('proof.json')), { proofId, class: entry.class, ...proof }, 'native proof');
  for (const [key, value] of Object.entries({ dispatchId: entry.dispatchId, unitId: entry.unitId, role: entry.role, vendor: entry.vendor, class: entry.class, model: entry.model, effort: entry.effort, proofId, modelRequested: entry.model, modelObserved: proof.modelObserved, planId: run.plan.planId, planHash: run.seal.planHash, escalation: entry.escalation === true, escalationReason: entry.escalationReason || null })) {
    if (state.telemetry[key] !== value || state.receipt[key] !== value) throw new Error(`receipt/telemetry ${key} mismatch`);
  }
  if (state.telemetry.authorVendor !== (entry.authorVendor || null)) throw new Error('telemetry authorVendor mismatch');
  const before = readJson(artifact('workspace-before.json'));
  const after = readJson(artifact('workspace-after.json'));
  if (before.root !== fs.realpathSync(entry.cwd) || after.root !== before.root) throw new Error('workspace snapshot has wrong root');
  const audit = compareWorkspace(before, after, entry.writeScope);
  same(readJson(artifact('scope-audit.json')), audit, 'scope audit');
  if (!audit.ok) throw new Error('scope audit failed');
  if (entry.role === 'implement' && audit.changedFiles.length === 0) throw new Error('implementation has no covered file change');
  same(state.receipt.changedFiles, audit.changedFiles, 'changed files');
  const rulesBefore = readJson(artifact('rules-source-before.json'));
  const rulesAfter = readJson(artifact('rules-source-after.json'));
  const rulesAudit = compareWorkspace(rulesBefore, rulesAfter, []);
  same(readJson(artifact('rules-source-audit.json')), rulesAudit, 'rules source audit');
  if (rulesBefore.root !== rulesAfter.root || !rulesAudit.ok) throw new Error('rules source changed during execution');
  const skillsBefore = readJson(artifact('skills-source-before.json'));
  const skillsAfter = readJson(artifact('skills-source-after.json'));
  const skillsAudit = Object.fromEntries(Object.keys(skillsBefore).map((skill) => [skill, compareWorkspace(skillsBefore[skill], skillsAfter[skill], [])]));
  same(readJson(artifact('skills-source-audit.json')), skillsAudit, 'skills source audit');
  if (Object.values(skillsAudit).some((audit) => !audit.ok)) throw new Error('skill source changed during execution');
  const response = finalResponse(entry.vendor, fs.readFileSync(artifact('capture.txt'), 'utf8'), { responseProtocol });
  if (response.split(/\r?\n/, 1)[0] !== fs.readFileSync(entry.brief, 'utf8').split(/\r?\n/, 1)[0]) throw new Error('native response has wrong brief acknowledgement');
  return { entry, state, proof, response, after };
}

function inspectRun(runDir) {
  const run = readSealedRun(runDir);
  const executions = [];
  const outcomes = [];
  const sessions = new Set();
  for (const entry of run.plan.dispatches) {
    const file = path.join(run.root, '.magi-dispatches', `${transactionKey(entry)}.json`);
    const outcome = { dispatchId: entry.dispatchId, unitId: entry.unitId, role: entry.role, vendor: entry.vendor, class: entry.class, planId: run.plan.planId, planHash: run.seal.planHash, status: 'NOT_RUN' };
    if (fs.existsSync(file)) {
      try {
        const state = readJson(file);
        same(state.entry, entry, 'transaction entry');
        if (state.planHash !== run.seal.planHash) throw new Error('transaction plan hash mismatch');
        if (!['PASS', 'FAIL', 'RUNNING'].includes(state.status)) throw new Error('unknown transaction status');
        outcome.status = state.status;
        if (state.status === 'PASS') {
          const execution = verifyExecution(run, entry, state);
          const session = `${entry.vendor}:${execution.proof.sessionId || execution.proof.conversationId}`;
          if (sessions.has(session)) throw new Error('native session reused across dispatches');
          sessions.add(session);
          executions.push(execution);
        } else if (state.error) outcome.error = state.error;
      } catch (error) { outcome.status = 'INVALID'; outcome.error = error.message; }
    }
    outcomes.push(outcome);
  }
  return { ...run, executions, outcomes };
}

function nativePosition(response) {
  const matches = [...response.matchAll(/^POSITION: (APPROVE|ABSTAIN|REJECT)\s*$/gm)];
  if (matches.length !== 1) throw new Error('native response requires exactly one POSITION: APPROVE|ABSTAIN|REJECT line');
  return matches[0][1];
}

function tallyUnit(run, unitId) {
  const planned = run.plan.dispatches.filter((entry) => entry.unitId === unitId);
  if (!planned.length) throw new Error('unit absent from sealed plan');
  const authorVendor = planned.find((entry) => entry.role === 'implement')?.vendor || planned.find((entry) => entry.authorVendor)?.authorVendor;
  if (!authorVendor) throw new Error('panel author provenance is missing');
  const ballots = [];
  for (const execution of run.executions.filter(({ entry }) => entry.unitId === unitId && ['review', 'verify'].includes(entry.role))) {
    const current = snapshotWorkspace(execution.entry.cwd);
    if (!compareWorkspace(execution.after, current, []).ok) throw new Error('worktree changed after panel evidence');
    ballots.push({ vendor: execution.entry.vendor, position: nativePosition(execution.response), role: execution.entry.role });
  }
  return { unitId, authorVendor, ...tally({ ballots, authorVendor }) };
}

function finalizeRun(runDir) {
  const run = inspectRun(runDir);
  const units = [];
  const unitIds = [...new Set(run.plan.dispatches.map((entry) => entry.unitId))];
  for (const unitId of unitIds) {
    const entries = run.plan.dispatches.filter((entry) => entry.unitId === unitId);
    const author = entries.find((entry) => entry.role === 'implement');
    const checked = run.executions.filter(({ entry }) => entry.unitId === unitId && ['review', 'verify'].includes(entry.role));
    let status = author || checked.length ? 'PASS' : 'NOT_REQUIRED';
    let reason = null;
    try {
      if (author && !['review', 'verify'].every((role) => checked.some(({ entry }) => entry.role === role && entry.vendor !== author.vendor))) throw new Error('successful independent review and verification are required');
      for (const execution of checked) {
        if (!compareWorkspace(execution.after, snapshotWorkspace(execution.entry.cwd), []).ok) throw new Error('worktree changed after review or verification');
      }
      if (author && !run.matrix.classes[author.class].requiresPanel) {
        for (const execution of checked) if (nativePosition(execution.response) !== 'APPROVE') throw new Error(`independent ${execution.entry.role} did not approve`);
      } else if (checked.length || (author && run.matrix.classes[author.class].requiresPanel)) {
        const decision = tallyUnit(run, unitId);
        if (!decision.passed) throw new Error(`panel ${decision.verdict}`);
      }
    } catch (error) { status = 'FAIL'; reason = error.message; }
    units.push({ unitId, status, reason });
  }
  const executionStatus = run.outcomes.every((row) => row.status === 'PASS') ? 'PASS' : 'FAIL';
  const approvalStatus = units.some((unit) => unit.status === 'FAIL') ? 'FAIL' : units.every((unit) => unit.status === 'NOT_REQUIRED') ? 'NOT_REQUIRED' : 'PASS';
  const rows = run.executions.map(({ state }) => state.telemetry);
  const terminalRows = run.outcomes.map((outcome) => rows.find((row) => row.dispatchId === outcome.dispatchId) || outcome);
  const writeRows = (file, values) => {
    if (!inside(file, run.root)) throw new Error('projection path is outside the run');
    assertPlainPath(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, values.map((row) => JSON.stringify(row)).join('\n') + (values.length ? '\n' : ''));
    fs.renameSync(temp, file);
  };
  for (const log of new Set(run.executions.flatMap(({ state }) => state.logs))) writeRows(log, rows.filter((row) => run.executions.find(({ state }) => state.telemetry === row).state.logs.includes(log)));
  writeRows(path.join(run.root, 'telemetry.jsonl'), terminalRows);
  writeRows(path.join(run.root, 'implementation.jsonl'), rows.filter((row) => row.role === 'implement'));
  const result = { schemaVersion: 1, planId: run.plan.planId, planHash: run.seal.planHash, executionStatus, approvalStatus, ok: executionStatus === 'PASS' && approvalStatus !== 'FAIL', outcomes: run.outcomes, units, finalizedAt: new Date().toISOString() };
  writeJson(path.join(run.root, 'run-summary.json'), result);
  return result;
}

function main(argv = process.argv.slice(2)) {
  try {
    if (argv.length !== 2 || argv[0] !== '--run-dir') throw new Error('Usage: run-finalize --run-dir <sealed run directory>');
    const result = finalizeRun(argv[1]);
    process.stdout.write(`${JSON.stringify(result)}\n`); return result.ok ? 0 : 1;
  } catch (error) { process.stderr.write(`RUN_FINALIZE_FAIL: ${error.message}\n`); return 1; }
}
if (require.main === module) process.exitCode = main();
module.exports = { finalizeRun, inspectRun, main, nativePosition, tallyUnit, verifyExecution };
