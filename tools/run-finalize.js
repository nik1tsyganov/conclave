#!/usr/bin/env node
// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with section 7 terms; see LICENSE.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSealedRun } = require('./plan-seal.js');
const { ATTESTATION_PROTOCOL, AWAITING_ATTESTATION, assertPlainPath, compareWorkspace, hash, hashFile, inside, runtimeManifest, snapshotWorkspace, transactionKey, verifyArtifacts, verifyCommittedRow, writeJson, policyPins } = require('./dispatch-evidence.js');
const { verifyNativeProof, verifyProof } = require('./cli-proof.js');
const { CLAUDE_RESPONSE_PROTOCOL, finalResponse, validateClaudeResponseLaunch } = require('./vendor-native.js');
const { tally } = require('./position-tally.js');
const { canonicalPlainPath, pathsOverlap } = require('./runtime-paths.js');
const { INSTRUCTION_READ_PROTOCOL, verifyInstructionReadEvidence } = require('./instruction-read-evidence.js');
const { buildSeatProfile, loadProfiles } = require('./seat-policy.js');
const { validateEvidenceReadDirs, snapshotEvidenceReads, validateEvidenceReadLaunch } = require('./evidence-read-access.js');
const { resolveVaultRoot } = require('./magi-vault.js');
const { linkRunToVault } = require('./magi-vault-link.js');

const SEQUENCE_PROTOCOL = 'magi-unit-sequence-v1';

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function compatible(committed, fresh, label) {
  if (!committed || typeof committed !== 'object' || !fresh || typeof fresh !== 'object') throw new Error(`${label} disagrees with committed evidence`);
  const differing = Object.keys(committed).filter((key) => JSON.stringify(committed[key]) !== JSON.stringify(fresh[key]));
  if (differing.length) throw new Error(`${label} disagrees with committed evidence (${differing.join(', ')})`);
}
function same(a, b, label) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${label} disagrees with committed evidence`); }
function validateLogDestinations(run, logs, evidenceDir, protectedPaths = []) {
  const reserved = [evidenceDir, run.planPath, run.sealPath, run.availablePath,
    ...['.magi-dispatches', '.magi-sessions', 'run-summary.json', 'telemetry.jsonl', 'implementation.jsonl'].map(name => path.join(run.root, name)),
    ...protectedPaths];
  for (const entry of run.plan.dispatches) {
    reserved.push(entry.brief, path.join(run.root, 'out', entry.dispatchId));
    const file = path.join(run.root, '.magi-dispatches', `${transactionKey(entry)}.json`);
    assertPlainPath(file);
    if (fs.existsSync(file)) {
      const state = readJson(file);
      reserved.push(state.evidenceDir, ...(state.artifacts || []).map(item => item.path));
    }
  }
  const protectedFiles = reserved.map(canonicalPlainPath);
  const root = canonicalPlainPath(run.root);
  const products = run.plan.dispatches.map(entry => canonicalPlainPath(entry.cwd));
  for (const file of logs) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || path.resolve(file) !== file) throw new Error('log destination must be an absolute normalized path');
    const destination = canonicalPlainPath(file);
    if (destination === root || !inside(destination, root) || products.some(product => inside(destination, product))) throw new Error('log destinations must remain inside the sealed run and outside product worktrees');
    if (protectedFiles.some(protectedFile => pathsOverlap(destination, protectedFile))) throw new Error('log destination overlaps dispatch evidence, control files, or protected inputs');
    assertPlainPath(file);
    if (fs.existsSync(file) && !fs.statSync(file).isFile()) throw new Error('log destination is not a regular file');
  }
}

function verifyPrerequisites(run, entry, before, startedAt) {
  if (!['review', 'verify'].includes(entry.role)) return [];
  const author = run.plan.dispatches.find(row => row.unitId === entry.unitId && row.role === 'implement');
  const verifiers = entry.role === 'review' ? run.plan.dispatches.filter(row => row.unitId === entry.unitId && row.role === 'verify' &&
    (author || entry.evidenceReadDirs?.some(dir => path.relative(canonicalPlainPath(dir), canonicalPlainPath(path.join(run.root, 'out', row.dispatchId))) === ''))) : [];
  if (!author && !verifiers.length) return [];
  if (entry.role === 'review' && !verifiers.length) throw new Error('planned verification is required before review');
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) throw new Error('sequence start time is missing or invalid');
  return [...(author ? [author] : []), ...verifiers].map(dependency => {
    const file = path.join(run.root, '.magi-dispatches', `${transactionKey(dependency)}.json`);
    const unfinished = dependency.role === 'implement' ? 'implementation must finish before its review or verification' : 'verification must finish before review';
    assertPlainPath(file);
    if (!fs.existsSync(file)) throw new Error(`${unfinished}: ${dependency.dispatchId}`);
    const state = readJson(file);
    if (state.status !== 'PASS') throw new Error(`${unfinished}: ${dependency.dispatchId}`);
    const execution = verifyExecution(run, dependency, state);
    const completed = Date.parse(state.receipt.completedAt);
    const committed = Date.parse(state.completedAt);
    if (!Number.isFinite(completed) || !Number.isFinite(committed) || committed < completed || committed > start) throw new Error(`sequence starts before prerequisite completed: ${dependency.dispatchId}`);
    if (dependency.role === 'verify' && nativePosition(execution.response) !== 'APPROVE') throw new Error(`verification did not approve: ${dependency.dispatchId}`);
    const audit = compareWorkspace(execution.after, before, dependency.role === 'implement' ? dependency.writeScope : []);
    // Other completed units may change other paths before verification starts.
    if (dependency.role === 'implement') {
      if (audit.gitChanged || audit.changedFiles.some(file => file.allowed)) throw new Error('implementation scope changed before its review or verification');
    } else if (!audit.ok) throw new Error('worktree changed after verification');
    return { dispatchId: dependency.dispatchId, proofId: state.receipt.proofId, transactionSha256: hashFile(file) };
  });
}

function verifyExecution(run, entry, state) {
  if (run.seal.instructionReadProtocol !== INSTRUCTION_READ_PROTOCOL) throw Object.assign(new Error('historical run has no native instruction-read assurance; use its matching runtime for historical inspection'), { code: 'INSTRUCTION_READ_COMPATIBILITY_FAIL' });
  if (state.status !== 'PASS') throw new Error('execution has no committed PASS transaction');
  return verifySavedExecution(run, entry, state, false);
}

function verifyCheckpoint(run, entry, state, { current = false, allowReceiptProjections = false } = {}) {
  if (run.seal.instructionReadProtocol !== INSTRUCTION_READ_PROTOCOL) throw Object.assign(new Error('historical checkpoint has no native instruction-read assurance; use its matching runtime for historical inspection'), { code: 'INSTRUCTION_READ_COMPATIBILITY_FAIL' });
  if (state.status !== AWAITING_ATTESTATION || entry.vendor !== 'anthropic') throw new Error('dispatch is not awaiting Claude attestation');
  const execution = verifySavedExecution(run, entry, state, true, allowReceiptProjections);
  if (current) {
    if (!compareWorkspace(execution.after, snapshotWorkspace(entry.cwd), []).ok) throw new Error('workspace changed after the attestation checkpoint');
    const artifact = name => path.join(state.evidenceDir, name);
    same(readJson(artifact('runtime-manifest.json')), runtimeManifest(), 'current runtime');
    const rules = readJson(artifact('rules-source-after.json'));
    if (!compareWorkspace(rules, snapshotWorkspace(rules.root), []).ok) throw new Error('rules source changed after the attestation checkpoint');
    for (const skill of Object.values(readJson(artifact('skills-source-after.json')))) {
      if (!compareWorkspace(skill, snapshotWorkspace(skill.root), []).ok) throw new Error('skill source changed after the attestation checkpoint');
    }
  }
  return execution;
}

function verifySavedExecution(run, entry, state, pending, allowReceiptProjections = false) {
  same(state.entry, entry, 'plan entry');
  if (state.planHash !== run.seal.planHash || state.planId !== run.plan.planId || state.requestHash !== hash(JSON.stringify({ planHash: run.seal.planHash, entry }))) throw new Error('transaction belongs to a different plan');
  const transactionPath = path.join(run.root, '.magi-dispatches', `${transactionKey(entry)}.json`);
  if (state.telemetry?.transactionPath !== transactionPath || !inside(state.evidenceDir, run.root)) throw new Error('transaction evidence is outside its sealed run');
  const projections = new Map();
  if (pending && allowReceiptProjections) {
    projections.set(path.join(state.evidenceDir, 'receipt-ack.json'), state.receipt);
    projections.set(path.join(state.evidenceDir, 'handoff-envelope.json'), { ...state.receipt, telemetryLog: state.receipt?.logDestinations?.telemetryLog });
    if (!Array.isArray(state.artifacts) || state.artifacts.length < 5) throw new Error('checkpoint has incomplete evidence');
    const pins = policyPins(state);
    for (const item of state.artifacts) {
      assertPlainPath(item.path);
      if (!projections.has(item.path)) {
        const pinned = pins.get(path.resolve(item.path));
        if (pinned !== undefined) { if (item.sha256 !== pinned) throw new Error(`committed policy differs from the sealed policy: ${item.path}`); continue; }
        if (hashFile(item.path) !== item.sha256) throw new Error(`committed evidence changed: ${item.path}`);
        continue;
      }
      const original = projections.get(item.path);
      const text = `${JSON.stringify(original, null, 2)}\n`;
      const completed = `${JSON.stringify({ ...original, status: 'PASS' }, null, 2)}\n`;
      const current = fs.readFileSync(item.path, 'utf8');
      if (hash(text) !== item.sha256 || (current !== text && current !== completed)) throw new Error('interrupted attestation receipt changed unexpectedly');
    }
  } else if (pending) verifyArtifacts(state);
  else verifyCommittedRow(state.telemetry, { checkLogs: false });
  if (state.receipt.status !== state.status || state.telemetry.status !== state.status) throw new Error('receipt/telemetry completion status mismatch');
  const artifact = (name) => path.join(state.evidenceDir, name);
  for (const name of ['capture.txt', 'vendor.log', 'proof.json', 'receipt-ack.json', 'handoff-envelope.json', 'scope-audit.json', 'plan-binding.json', 'launch.json', 'workspace-before.json', 'workspace-after.json', 'runtime-manifest.json', 'rules-source-before.json', 'rules-source-after.json', 'rules-source-audit.json', 'skills-source-before.json', 'skills-source-after.json', 'skills-source-audit.json']) {
    if (!state.artifacts.some((item) => item.path === artifact(name) && item.sha256 === (projections.has(item.path) ? hash(`${JSON.stringify(projections.get(item.path), null, 2)}\n`) : hashFile(artifact(name))))) throw new Error(`missing committed artifact: ${name}`);
  }
  const launch = readJson(artifact('launch.json'));
  if (entry.evidenceReadDirs?.length) {
    const dirs = validateEvidenceReadDirs(entry, { plan: run.plan, runDir: run.root, requireExisting: true,
      forbiddenRoots: [run.seal.skillSource?.sourceRoot, readJson(artifact('rules-source-before.json')).root].filter(Boolean) });
    validateEvidenceReadLaunch(launch, entry, dirs, { cwd: entry.cwd, briefPath: artifact('brief/BRIEF.md'), skillRoot: artifact('skills'), seatContractPath: artifact('SEAT-CONTRACT.md') });
    for (const name of ['evidence-reads-before.json', 'evidence-reads-after.json']) {
      if (!state.artifacts.some(item => item.path === artifact(name) && item.sha256 === hashFile(artifact(name)))) throw new Error(`missing committed evidence input artifact: ${name}`);
    }
    same(readJson(artifact('evidence-reads-before.json')), readJson(artifact('evidence-reads-after.json')), 'read-only evidence inputs');
    if (launch.evidenceReadsSha256 !== hash(JSON.stringify(readJson(artifact('evidence-reads-before.json'))))) throw new Error('evidence input hashes differ from launch binding');
    same(snapshotEvidenceReads(dirs), readJson(artifact('evidence-reads-after.json')), 'current evidence inputs');
  } else if (launch.evidenceReadDirs?.length) throw new Error('unbound evidence read directories in launch');
  if (launch.instructionReadProtocol !== INSTRUCTION_READ_PROTOCOL || state.receipt.instructionReadProtocol !== INSTRUCTION_READ_PROTOCOL) throw new Error('missing or unsupported native instruction-read protocol');
  for (const name of ['native-instructions.jsonl', 'instruction-transcript.json', 'instruction-reads.json']) {
    if (!state.artifacts.some(item => item.path === artifact(name) && item.sha256 === hashFile(artifact(name)))) throw new Error(`missing committed instruction artifact: ${name}`);
  }
  const postRun = entry.vendor === 'anthropic' && Boolean(run.seal.attestationProtocol || state.attestationProtocol || launch.attestationProtocol || state.receipt.attestationProtocol);
  if (pending && !postRun) throw new Error('checkpoint is missing its attestation protocol');
  if (postRun && [state.attestationProtocol, launch.attestationProtocol, state.receipt.attestationProtocol].some(value => value !== ATTESTATION_PROTOCOL)) throw new Error('missing or unsupported attestation protocol');
  if (postRun && run.seal.attestationProtocol !== undefined && run.seal.attestationProtocol !== ATTESTATION_PROTOCOL) throw new Error('unsupported sealed attestation protocol');
  const responseProtocol = entry.vendor === 'anthropic' ? CLAUDE_RESPONSE_PROTOCOL : undefined;
  if (responseProtocol) validateClaudeResponseLaunch(launch);
  const runtimeSha256 = hash(JSON.stringify(readJson(artifact('runtime-manifest.json'))));
  if (launch.runtimeSha256 !== runtimeSha256 || state.receipt.runtimeSha256 !== runtimeSha256) throw new Error('runtime identity mismatch');
  same(launch.planEntry, entry, 'launch');
  same(readJson(artifact('plan-binding.json')), { planId: run.plan.planId, planHash: run.seal.planHash, entry }, 'binding');
  same(projections.get(artifact('receipt-ack.json')) || readJson(artifact('receipt-ack.json')), state.receipt, 'receipt');
  const envelope = projections.get(artifact('handoff-envelope.json')) || readJson(artifact('handoff-envelope.json'));
  const { telemetryLog, ...receiptEnvelope } = envelope;
  same(receiptEnvelope, state.receipt, 'handoff');
  let logs = state.logs;
  if (postRun) {
    const destinations = launch.logDestinations;
    if (!destinations || typeof destinations !== 'object' || Array.isArray(destinations)) throw new Error('missing protected log destinations');
    same(destinations, { telemetryLog: destinations.telemetryLog, activationLog: destinations.activationLog }, 'log destination fields');
    logs = [...new Set([destinations.telemetryLog, destinations.activationLog])];
    const rules = readJson(artifact('rules-source-after.json'));
    const skills = Object.values(readJson(artifact('skills-source-after.json')));
    validateLogDestinations(run, logs, state.evidenceDir, [rules.root, ...skills.map(skill => skill.root)]);
    same(state.logs, logs, 'log destinations');
    same(state.receipt.logDestinations, destinations, 'receipt log destinations');
    if (telemetryLog !== destinations.telemetryLog) throw new Error('handoff log destination changed');
  }
  const spec = run.matrix.vendors[entry.vendor].models[entry.model];
  const proof = (postRun ? verifyNativeProof : verifyProof)({ vendor: entry.vendor, capture: artifact('capture.txt'), log: artifact('vendor.log'), expectedModel: entry.model, expectedObservedModel: spec.canonical || entry.model, expectedEffort: entry.effort,
    // A Codex checking seat launches under the bound read-only scratch profile ("custom permissions"),
    // so replay must hand cli-proof the same binding dispatch-run used, not the role default.
    expectedSandbox: entry.vendor === 'openai' ? (launch.scratchPermissions ? 'custom permissions' : (entry.role === 'implement' ? 'workspace-write' : 'read-only')) : undefined,
    ...(entry.vendor === 'openai' && launch.scratchPermissions ? { launch, runDir: run.root, dispatchId: entry.dispatchId, expectedRole: entry.role, expectedCwd: entry.cwd } : {}),
    onTopic: true, responseProtocol });
  const response = finalResponse(entry.vendor, fs.readFileSync(artifact('capture.txt'), 'utf8'), { responseProtocol });
  if (response.split(/\r?\n/, 1)[0] !== fs.readFileSync(entry.brief, 'utf8').split(/\r?\n/, 1)[0]) throw new Error('native response has wrong brief acknowledgement');
  const sessionId = proof.sessionId || proof.conversationId;
  const transcriptText = fs.readFileSync(artifact('native-instructions.jsonl'), 'utf8');
  const transcriptBinding = readJson(artifact('instruction-transcript.json'));
  if (typeof transcriptBinding.sourcePath !== 'string' || !path.isAbsolute(transcriptBinding.sourcePath)) throw new Error('native instruction transcript source is missing');
  same(transcriptBinding, { protocol: INSTRUCTION_READ_PROTOCOL, vendor: entry.vendor, sessionId,
    sourcePath: transcriptBinding.sourcePath, sha256: hash(transcriptText) }, 'instruction transcript binding');
  const captureText = fs.readFileSync(artifact('capture.txt'), 'utf8');
  if (entry.vendor === 'anthropic' && (transcriptText !== captureText || transcriptBinding.sourcePath !== artifact('capture.txt'))) throw new Error('Claude instruction transcript differs from its native capture');
  const seatProfile = buildSeatProfile(loadProfiles(), entry);
  same(readJson(artifact('seat-profile.json')), seatProfile, 'instruction seat profile');
  const instructionReads = verifyInstructionReadEvidence({ vendor: entry.vendor, sessionId, captureText, transcriptText,
    googleTranscriptBinding: { conversationId: sessionId, sha256: transcriptBinding.sha256 },
    briefPath: artifact('brief/BRIEF.md'), seatContractPath: artifact('SEAT-CONTRACT.md'), skillRoot: artifact('skills'), seatProfile,
    rulesManifest: readJson(artifact('brief/rules-manifest.json')), skillsManifest: readJson(artifact('skills/skills-manifest.json')) });
  same(readJson(artifact('instruction-reads.json')), instructionReads, 'native instruction reads');
  if (state.receipt.instructionReadEvidenceSha256 !== hashFile(artifact('instruction-reads.json'))) throw new Error('receipt instruction evidence hash mismatch');
  proof.instructionReads = { protocol: INSTRUCTION_READ_PROTOCOL, requiredSetSha256: instructionReads.requiredSetSha256, evidenceSha256: instructionReads.evidenceSha256 };
  if (postRun) proof.attestationProtocol = ATTESTATION_PROTOCOL;
  Object.assign(proof, { planId: run.plan.planId, planHash: run.seal.planHash, escalation: entry.escalation === true, escalationReason: entry.escalationReason || null });
  let proofId = hash(JSON.stringify(proof)); // recomputed from live evidence; superseded below by the committed id once the committed fields verify
  // Forward-compatible: a later runtime may derive MORE proof fields from the same
  // native evidence (e.g. Google vendorSideTokens, 2026-09-16); every committed field
  // must still recompute identically, and no committed field may vanish.
  const committedProof = readJson(artifact('proof.json'));
  const { proofId: committedProofId, class: _committedClass, ...committedFields } = committedProof;
  void _committedClass;
  if (hash(JSON.stringify(committedFields)) !== committedProofId) throw new Error('native proof id does not match its committed fields');
  compatible(committedProof, { proofId: committedProofId, class: entry.class, ...proof }, 'native proof');
  proofId = committedProofId;
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
  if (postRun) {
    const started = Date.parse(state.startedAt);
    const finished = Date.parse(state.receipt.completedAt);
    const committed = Date.parse(state.completedAt);
    if (launch.startedAt !== state.startedAt || !Number.isFinite(started) || !Number.isFinite(finished) || !Number.isFinite(committed) || finished < started || committed < finished) throw new Error('invalid attestation execution timestamps');
    for (const name of ['checkpoint.json', 'response.txt', ...(!pending ? ['attestation.json'] : [])]) {
      if (!state.artifacts.some(item => item.path === artifact(name) && item.sha256 === hashFile(artifact(name)))) throw new Error(`missing committed attestation artifact: ${name}`);
    }
    if (fs.readFileSync(artifact('response.txt'), 'utf8') !== response) throw new Error('checkpoint response differs from native output');
    const checkpoint = readJson(artifact('checkpoint.json'));
    if (state.receipt.captureSha256 !== hashFile(artifact('capture.txt'))) throw new Error('receipt capture hash differs from native output');
    const { protectedInputs, recordedAt, ...binding } = checkpoint;
    same(binding, { schemaVersion: 1, status: AWAITING_ATTESTATION, protocol: ATTESTATION_PROTOCOL, planId: run.plan.planId, planHash: run.seal.planHash, dispatchId: entry.dispatchId, unitId: entry.unitId, proofId, captureSha256: hashFile(artifact('capture.txt')), responseSha256: hash(response), completedAt: state.receipt.completedAt, logDestinations: launch.logDestinations }, 'attestation checkpoint');
    if (!Array.isArray(protectedInputs) || !protectedInputs.length) throw new Error('checkpoint protected inputs are missing');
    for (const item of protectedInputs) {
      if (!state.artifacts.some(artifact => artifact.path === item.path && artifact.sha256 === item.sha256)) throw new Error('checkpoint protected input binding changed');
    }
    const completed = Date.parse(state.receipt.completedAt);
    const recorded = Date.parse(recordedAt);
    if (!Number.isFinite(recorded) || !Number.isFinite(completed) || recorded < completed) throw new Error('invalid attestation checkpoint timestamp');
    if (!pending) {
      const { acceptedAt, ...attestation } = readJson(artifact('attestation.json'));
      same(attestation, { schemaVersion: 1, protocol: ATTESTATION_PROTOCOL, decision: 'ON_TOPIC', planId: run.plan.planId, planHash: run.seal.planHash, dispatchId: entry.dispatchId, unitId: entry.unitId, proofId, captureSha256: checkpoint.captureSha256, checkpointSha256: hashFile(artifact('checkpoint.json')) }, 'post-run attestation');
      const accepted = Date.parse(acceptedAt);
      const committed = Date.parse(state.completedAt);
      if (!Number.isFinite(accepted) || accepted < recorded || !Number.isFinite(committed) || committed < accepted) throw new Error('invalid post-run attestation timestamp');
    }
  }
  if (['review', 'verify'].includes(entry.role) && run.plan.dispatches.some(row => row.unitId === entry.unitId && row.role === 'implement')) {
    if (launch.sequenceProtocol !== SEQUENCE_PROTOCOL) throw new Error('missing or unsupported sequence protocol');
    const start = Date.parse(launch.startedAt);
    const completed = Date.parse(state.receipt.completedAt);
    const committed = Date.parse(state.completedAt);
    if (launch.startedAt !== state.startedAt || !Number.isFinite(start) || !Number.isFinite(completed) || !Number.isFinite(committed) || completed < start || committed < completed) throw new Error('sequence timestamps disagree with committed evidence');
    same(launch.prerequisites, verifyPrerequisites(run, entry, before, launch.startedAt), 'sequence prerequisites');
  }
  return { entry, state, proof, response, before, after, logs };
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
        if (!['PASS', 'FAIL', 'RUNNING', 'RETRYABLE', AWAITING_ATTESTATION].includes(state.status)) throw new Error('unknown transaction status');
        outcome.status = state.status;
        if (state.status === 'PASS') {
          const execution = verifyExecution(run, entry, state);
          const session = `${entry.vendor}:${execution.proof.sessionId || execution.proof.conversationId}`;
          if (sessions.has(session)) throw new Error('native session reused across dispatches');
          sessions.add(session);
          executions.push(execution);
        } else if (state.status === AWAITING_ATTESTATION) {
          verifyCheckpoint(run, entry, state);
          outcome.error = 'Claude output awaits post-run inspection and capture-bound --on-topic attestation; no completion or approval is committed.';
          outcome.evidenceDir = state.evidenceDir;
        } else if (state.status === 'RETRYABLE') outcome.error = `launch failure classified retryable (${state.attempts?.at(-1)?.signature}); not re-dispatched`;
        else if (state.error) outcome.error = state.error;
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
  const ballotsByVendor = new Map();
  for (const execution of run.executions.filter(({ entry }) => entry.unitId === unitId && ['review', 'verify'].includes(entry.role))) {
    const current = snapshotWorkspace(execution.entry.cwd);
    if (!compareWorkspace(execution.after, current, []).ok) throw new Error('worktree changed after panel evidence');
    const ballot = { vendor: execution.entry.vendor, position: nativePosition(execution.response), role: execution.entry.role };
    const prior = ballotsByVendor.get(ballot.vendor);
    if (prior && prior.position !== ballot.position) throw new Error(`conflicting positions from ${ballot.vendor}`);
    // Every checking row was validated above; agreeing rows still provide only one vendor vote.
    if (!prior) ballotsByVendor.set(ballot.vendor, ballot);
  }
  const ballots = [...ballotsByVendor.values()];
  return { unitId, authorVendor, ...tally({ ballots, authorVendor }) };
}

function assessRun(run) {
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
  return { schemaVersion: 1, planId: run.plan.planId, planHash: run.seal.planHash, executionStatus, approvalStatus, ok: executionStatus === 'PASS' && approvalStatus !== 'FAIL', outcomes: run.outcomes, units, finalizedAt: new Date().toISOString() };
}

function shouldLinkVault(runDir, env = process.env) {
  if (!env.MAGI_VAULT_ROOT || env.MAGI_VAULT_LINK === '0') return false;
  return !inside(path.resolve(runDir), path.resolve(os.tmpdir()));
}

function finalizeRun(runDir) {
  const run = inspectRun(runDir);
  if (run.seal.instructionReadProtocol !== INSTRUCTION_READ_PROTOCOL) throw Object.assign(new Error('historical run has no native instruction-read assurance; current finalization cannot rewrite its projections'), { code: 'INSTRUCTION_READ_COMPATIBILITY_FAIL' });
  const result = assessRun(run);
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
  // Completion telemetry (2026-09-16): one row per unit with the panel and Jev
  // verdicts, tokens and durations, plus one row per run. Derived from the same
  // receipts as everything above; idempotent by planHash (+ unitId).
  const unitRows = buildUnitRows(run, result, rows);
  const runRow = buildRunRow(run, result, rows, unitRows);
  writeRows(path.join(run.root, 'units.jsonl'), unitRows);
  writeJson(path.join(run.root, 'run-row.json'), runRow);
  writeJson(path.join(run.root, 'run-summary.json'), { ...result, unitRows, runRow });
  return { ...result, unitRows, runRow };
}

function sumTokens(rowsOf) {
  const by = {};
  for (const row of rowsOf) if (typeof row.vendorSideTokens === 'number') by[row.vendor] = (by[row.vendor] || 0) + row.vendorSideTokens;
  return { byVendor: by, total: Object.values(by).reduce((a, b) => a + b, 0) };
}
function spanMs(states) {
  const starts = states.map((s) => Date.parse(s.startedAt)).filter(Number.isFinite);
  const ends = states.map((s) => Date.parse(s.completedAt)).filter(Number.isFinite);
  return starts.length && ends.length ? Math.max(0, Math.max(...ends) - Math.min(...starts)) : null;
}
function readJevTally(run, unitId) {
  const file = path.join(run.root, `jev-tally-${unitId}.json`);
  if (!fs.existsSync(file)) return null;
  try { const t = JSON.parse(fs.readFileSync(file, 'utf8')); return { verdict: t.verdict, counts: t.counts || null, score: t.jev?.score ?? null, confidence: t.jev?.confidence ?? null, flags: t.flags || [], degraded: t.degraded === true }; } catch { return null; }
}
function buildUnitRows(run, result, rows) {
  return result.units.map((unit) => {
    const entries = run.plan.dispatches.filter((entry) => entry.unitId === unit.unitId);
    const author = entries.find((entry) => entry.role === 'implement');
    const executions = run.executions.filter(({ entry }) => entry.unitId === unit.unitId);
    const dispatches = entries.map((entry) => {
      const execution = executions.find((ex) => ex.entry.dispatchId === entry.dispatchId);
      const row = rows.find((r) => r.dispatchId === entry.dispatchId);
      const outcome = result.outcomes.find((o) => o.dispatchId === entry.dispatchId);
      return { dispatchId: entry.dispatchId, role: entry.role, vendor: entry.vendor, model: entry.model, modelObserved: row?.modelObserved || null, status: outcome?.status || 'NOT_RUN',
        tokens: row?.vendorSideTokens ?? null, durationMs: execution ? Math.max(0, Date.parse(execution.state.completedAt) - Date.parse(execution.state.startedAt)) : null,
        position: execution && ['verify', 'review'].includes(entry.role) ? (() => { try { return nativePosition(execution.response); } catch { return null; } })() : null };
    });
    let panel = null;
    try { const t = tallyUnit(run, unit.unitId); panel = { verdict: t.verdict, passed: t.passed, approve: t.approveCount, reject: t.rejectCount, abstain: t.abstainCount }; } catch (error) { panel = { verdict: 'NOT_PANEL', reason: error.message }; }
    const tokens = sumTokens(rows.filter((r) => r.unitId === unit.unitId));
    return { schemaVersion: 1, kind: 'unit', key: `${run.seal.planHash}:${unit.unitId}`, planId: run.plan.planId, planHash: run.seal.planHash, hostMode: run.plan.hostMode, date: result.finalizedAt.slice(0, 10),
      unitId: unit.unitId, class: author?.class || entries[0]?.class || null, authorVendor: author?.vendor || null, approval: unit.status, reason: unit.reason, panel, jev: readJevTally(run, unit.unitId),
      dispatches, tokensByVendor: tokens.byVendor, tokensTotal: tokens.total, durationMs: spanMs(executions.map((ex) => ex.state)), finalizedAt: result.finalizedAt };
  });
}
function buildRunRow(run, result, rows, unitRows) {
  const tokens = sumTokens(rows);
  const count = (status) => result.outcomes.filter((o) => o.status === status).length;
  return { schemaVersion: 1, kind: 'run', key: run.seal.planHash, planId: run.plan.planId, planHash: run.seal.planHash, hostMode: run.plan.hostMode, arbiter: run.plan.arbiter || null, date: result.finalizedAt.slice(0, 10),
    executionStatus: result.executionStatus, approvalStatus: result.approvalStatus, ok: result.ok,
    dispatches: result.outcomes.length, pass: count('PASS'), fail: count('FAIL'), notRun: count('NOT_RUN'),
    units: unitRows.map((u) => ({ unitId: u.unitId, approval: u.approval, panel: u.panel?.verdict || null, jev: u.jev?.verdict || null })),
    tokensByVendor: tokens.byVendor, tokensTotal: tokens.total, wallMs: spanMs(run.executions.map((ex) => ex.state)), jevClassify: run.seal.jevClassify ? { status: run.seal.jevClassify.status, units: Object.fromEntries(Object.entries(run.seal.jevClassify.units || {}).map(([u, r]) => [u, { class: r.jevClass, p: r.p, agrees: r.agrees }])) } : null,
    sealedAt: run.seal.sealedAt, finalizedAt: result.finalizedAt };
}

function main(argv = process.argv.slice(2)) {
  try {
    if (argv.length !== 2 || argv[0] !== '--run-dir') throw new Error('Usage: run-finalize --run-dir <sealed run directory>');
    const result = finalizeRun(argv[1]);
    if (shouldLinkVault(argv[1])) {
      if (!resolveVaultRoot()) throw new Error('MAGI_VAULT_ROOT is set but is not an ai-ops-vault');
      result.vault = linkRunToVault({ runDir: argv[1] });
    }
    process.stdout.write(`${JSON.stringify(result)}\n`); return result.ok ? 0 : 1;
  } catch (error) { process.stderr.write(`RUN_FINALIZE_FAIL: ${error.message}\n`); return 1; }
}
if (require.main === module) process.exitCode = main();
module.exports = { SEQUENCE_PROTOCOL, assessRun, finalizeRun, inspectRun, main, nativePosition, shouldLinkVault, tallyUnit, validateLogDestinations, verifyCheckpoint, verifyExecution, verifyPrerequisites };
