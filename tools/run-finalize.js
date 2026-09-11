#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSealedRun } = require('./plan-seal.js');
const { ATTESTATION_PROTOCOL, AWAITING_ATTESTATION, RECOVERY_PROTOCOL, assertPlainPath, compareWorkspace, hash, hashFile, inside, recoveryPaths, runtimeManifest, snapshotWorkspace, transactionKey, verifyArtifacts, verifyCommittedRow, writeJson } = require('./dispatch-evidence.js');
const { verifyNativeProof, verifyProof } = require('./cli-proof.js');
const { CLAUDE_RESPONSE_PROTOCOL, codexSessionTranscript, finalResponse, validateClaudeResponseLaunch } = require('./vendor-native.js');
const { routeAllowed, loadAvailability } = require('./dispatch-matrix.js');
const { verifyStagedRules } = require('./cli-rules-stage.js');
const { verifySeatSkills } = require('./cli-skill-stage.js');
const { validateOpenaiScratchLaunch } = require('./cli-adapters.js');
const { tally } = require('./position-tally.js');
const { canonicalPlainPath, pathsOverlap } = require('./runtime-paths.js');
const { INSTRUCTION_READ_PROTOCOL, verifyInstructionReadEvidence } = require('./instruction-read-evidence.js');
const { buildSeatProfile, loadProfiles } = require('./seat-policy.js');
const { validateEvidenceReadDirs, snapshotEvidenceReads, validateEvidenceReadLaunch } = require('./evidence-read-access.js');
const { resolveVaultRoot } = require('./magi-vault.js');
const { linkRunToVault } = require('./magi-vault-link.js');

const SEQUENCE_PROTOCOL = 'magi-unit-sequence-v1';

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function same(a, b, label) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${label} disagrees with committed evidence`); }
function validateLogDestinations(run, logs, evidenceDir, protectedPaths = []) {
  const reserved = [evidenceDir, run.planPath, run.sealPath, run.availablePath,
    ...['.magi-dispatches', '.magi-recoveries', '.magi-sessions', 'run-summary.json', 'telemetry.jsonl', 'implementation.jsonl'].map(name => path.join(run.root, name)),
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

function interruptedSnapshot(run, entry, dependencies = {}) {
  if (entry.vendor !== 'openai' || !['review', 'verify', 'plan'].includes(entry.role) || entry.writeScope?.length !== 0) throw new Error('recovery supports only OpenAI read-only review, verify or plan entries');
  const originalFile = path.join(run.root, '.magi-dispatches', `${transactionKey(entry)}.json`);
  assertPlainPath(originalFile);
  const original = readJson(originalFile);
  same(original.entry, entry, 'interrupted entry');
  if (original.status !== 'RUNNING' || original.receipt || original.telemetry || original.completedAt || original.artifacts || original.planHash !== run.seal.planHash || original.planId !== run.plan.planId ||
      original.requestHash !== hash(JSON.stringify({ planHash: run.seal.planHash, entry }))) throw new Error('recovery requires an uncompleted RUNNING original transaction');
  const evidenceDir = path.join(run.root, 'out', entry.dispatchId);
  if (original.evidenceDir !== evidenceDir) throw new Error('interrupted evidence directory is not canonical');
  assertPlainPath(evidenceDir);
  for (const name of ['capture.txt', 'vendor.log', 'proof.json', 'receipt-ack.json', 'handoff-envelope.json', 'checkpoint.json', 'workspace-after.json', 'scope-audit.json']) {
    if (fs.existsSync(path.join(evidenceDir, name))) throw new Error(`interrupted attempt already has terminal or partial completion evidence: ${name}`);
  }
  const artifact = name => path.join(evidenceDir, name);
  const launch = readJson(artifact('launch.json'));
  same(launch.planEntry, entry, 'interrupted launch entry');
  same(readJson(artifact('plan-binding.json')), { planId: run.plan.planId, planHash: run.seal.planHash, entry }, 'interrupted plan binding');
  if (launch.startedAt !== original.startedAt || launch.planHash !== run.seal.planHash || launch.planId !== run.plan.planId || launch.model !== entry.model || launch.effort !== entry.effort || launch.cwd !== entry.cwd || launch.role !== entry.role || launch.vendor !== entry.vendor) throw new Error('interrupted launch identity changed');
  if (!launch.scratchPermissions) throw new Error('recovery requires the original bound OpenAI read-only scratch profile');
  validateOpenaiScratchLaunch(launch, { runDir: run.root, dispatchId: entry.dispatchId, role: entry.role, cwd: entry.cwd, model: entry.model, effort: entry.effort, capturePath: artifact('capture.txt') });
  const runtime = readJson(artifact('runtime-manifest.json'));
  if (hash(JSON.stringify(runtime)) !== launch.runtimeSha256) throw new Error('interrupted runtime manifest changed');
  if (hashFile(entry.brief) !== entry.briefSha256 || hashFile(artifact('brief/BRIEF.md')) !== entry.briefSha256) throw new Error('interrupted brief changed');
  verifyStagedRules(artifact('brief/BRIEF.md'));
  const profile = buildSeatProfile(loadProfiles(), entry);
  same(readJson(artifact('seat-profile.json')), profile, 'interrupted seat profile');
  verifySeatSkills({ destinationRoot: artifact('skills'), skills: profile.skills, manifest: readJson(artifact('skills/skills-manifest.json')) });
  const workspace = readJson(artifact('workspace-before.json'));
  if (workspace.root !== fs.realpathSync(entry.cwd) || !compareWorkspace(workspace, snapshotWorkspace(entry.cwd), []).ok) throw new Error('frozen interrupted workspace changed');
  const rules = readJson(artifact('rules-source-before.json'));
  const skills = readJson(artifact('skills-source-before.json'));
  for (const source of [rules, ...Object.values(skills)]) {
    if (!compareWorkspace(source, snapshotWorkspace(source.root), []).ok) throw new Error('interrupted instruction source changed');
  }
  const evidenceReads = snapshotEvidenceReads(validateEvidenceReadDirs(entry, { plan: run.plan, runDir: run.root, requireExisting: true }));
  if (entry.evidenceReadDirs?.length) {
    same(readJson(artifact('evidence-reads-before.json')), evidenceReads, 'frozen interrupted evidence inputs');
    if (launch.evidenceReadsSha256 !== hash(JSON.stringify(evidenceReads))) throw new Error('interrupted evidence-read binding changed');
  }
  const stderr = fs.readFileSync(artifact('stderr.log'), 'utf8');
  const header = stderr.split(/^user\s*$/m, 1)[0];
  const fields = regex => [...header.matchAll(regex)].map(match => match[1]);
  const ids = fields(/^session id\s*:\s*(\S+)/gm);
  if (ids.length !== 1 || !/^[a-f0-9-]{36}$/i.test(ids[0]) || fields(/^model\s*:\s*(\S+)/gm).join() !== entry.model || fields(/^reasoning effort\s*:\s*(\S+)/gm).join() !== entry.effort || /^tokens used\s*$/m.test(stderr)) throw new Error('interrupted native identity is missing, ambiguous or already complete');
  const native = (dependencies.codexSessionTranscript || codexSessionTranscript)(ids[0], { cwd: entry.cwd });
  assertPlainPath(native.path);
  if (native.text !== fs.readFileSync(native.path, 'utf8')) throw new Error('interrupted native transcript differs from disk');
  const rows = native.text.split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const sessions = rows.filter(row => row.type === 'session_meta');
  if (sessions.length !== 1 || sessions[0].payload?.id !== ids[0] || path.resolve(sessions[0].payload.cwd || '') !== path.resolve(entry.cwd)) throw new Error('interrupted transcript has the wrong identity');
  if (rows.some(row => ['task_complete', 'task_aborted', 'turn_aborted'].includes(row.payload?.type) ||
      (row.type === 'response_item' && row.payload?.role === 'assistant' && ['final', 'final_answer'].includes(row.payload?.phase)))) throw new Error('interrupted native transcript already has a terminal response or event');
  const pidText = fs.readFileSync(artifact('child.pid'), 'utf8').trim();
  if (!/^[1-9][0-9]*$/.test(pidText) || !Number.isSafeInteger(Number(pidText))) throw new Error('interrupted child PID is missing or invalid');
  const prerequisites = run.plan.dispatches.filter(row => row.dispatchId !== entry.dispatchId).map(dependency => {
    const file = path.join(run.root, '.magi-dispatches', `${transactionKey(dependency)}.json`);
    const state = readJson(file);
    verifyExecution(run, dependency, state);
    return { dispatchId: dependency.dispatchId, path: file, sha256: hashFile(file) };
  });
  same(launch.prerequisites, verifyPrerequisites(run, entry, workspace, launch.startedAt), 'interrupted sequence prerequisites');
  return { originalFile, originalSha256: hashFile(originalFile), evidenceDir, evidence: snapshotWorkspace(evidenceDir),
    native: { sessionId: ids[0], path: native.path, sha256: hashFile(native.path) }, pid: Number(pidText), workspace, evidenceReads,
    inputs: [run.planPath, run.sealPath, run.availablePath, entry.brief].map(file => ({ path: file, sha256: hashFile(file) })), prerequisites };
}

function verifyRecoveryManifest(run, entry, manifest, { nowMs, dependencies = {} } = {}) {
  const paths = recoveryPaths(run.root, entry);
  const { schemaVersion, protocol, planId, planHash, entry: savedEntry, attemptRoot, transactionPath, preparedAt, original, availability, stopped } = manifest;
  same(Object.keys(manifest).sort(), ['schemaVersion', 'protocol', 'planId', 'planHash', 'entry', 'attemptRoot', 'transactionPath', 'preparedAt', 'original', 'availability', 'stopped'].sort(), 'recovery manifest fields');
  if (schemaVersion !== 1 || protocol !== RECOVERY_PROTOCOL || planId !== run.plan.planId || planHash !== run.seal.planHash || attemptRoot !== paths.attemptRoot || transactionPath !== paths.transactionPath || !Number.isFinite(Date.parse(preparedAt))) throw new Error('recovery manifest identity changed');
  same(savedEntry, entry, 'recovery plan entry');
  const originalNative = original?.native;
  if (!originalNative || !path.isAbsolute(originalNative.path || '')) throw new Error('recovery native transcript path is missing');
  same(original, interruptedSnapshot(run, entry, { ...dependencies, codexSessionTranscript: id => {
    if (id !== originalNative.sessionId) throw new Error('interrupted native session changed');
    return { path: originalNative.path, text: fs.readFileSync(originalNative.path, 'utf8') };
  } }), 'recovery frozen original evidence');
  if (stopped?.status !== 'ABSENT' || stopped.pid !== original.pid) throw new Error('recovery has no stopped-child evidence');
  if (!availability || !path.isAbsolute(availability.path || '') || hashFile(availability.path) !== availability.sha256) throw new Error('recovery availability changed');
  assertPlainPath(availability.path);
  const route = routeAllowed(run.matrix, entry, loadAvailability(availability.path), nowMs ?? Date.parse(preparedAt));
  if (!route.ok) throw new Error(route.reason);
  return paths;
}

function resolveRecovery(run, entry, original) {
  const paths = recoveryPaths(run.root, entry);
  if (!fs.existsSync(paths.root)) return null;
  assertPlainPath(paths.root);
  if (fs.readdirSync(paths.root).some(name => !['recovery.json', 'transaction.json', 'attempt'].includes(name))) throw new Error('unexpected or duplicate recovery attempt');
  if (fs.existsSync(paths.attemptRoot) && (fs.readdirSync(paths.attemptRoot).some(name => name !== 'out') ||
      (fs.existsSync(path.join(paths.attemptRoot, 'out')) && fs.readdirSync(path.join(paths.attemptRoot, 'out')).some(name => name !== entry.dispatchId)))) throw new Error('unexpected physical recovery attempt');
  if (original.status !== 'RUNNING') throw new Error('recovery conflicts with an original terminal attempt');
  if (!fs.existsSync(paths.manifestPath) || !fs.existsSync(paths.transactionPath)) throw new Error('recovery lineage is missing or incomplete');
  const manifest = readJson(paths.manifestPath);
  const state = readJson(paths.transactionPath);
  verifyRecoveryManifest(run, entry, manifest, { nowMs: Date.parse(state.startedAt) });
  if (state.recoverySha256 !== hashFile(paths.manifestPath) || state.evidenceDir !== path.join(paths.attemptRoot, 'out', entry.dispatchId) ||
      !Number.isFinite(Date.parse(state.startedAt)) || Date.parse(state.startedAt) < Date.parse(manifest.preparedAt)) throw new Error('replacement transaction has missing or changed recovery lineage');
  if (!['RUNNING', 'PASS', 'FAIL'].includes(state.status)) throw new Error('unsupported replacement transaction status');
  if (state.receipt?.completedAt && Date.parse(state.receipt.completedAt) < Date.parse(state.startedAt)) throw new Error('replacement completion precedes launch');
  return { ...paths, manifest, state };
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
  const originalPath = path.join(run.root, '.magi-dispatches', `${transactionKey(entry)}.json`);
  const recovery = state.recoverySha256 ? resolveRecovery(run, entry, readJson(originalPath)) : null;
  if (recovery) same(recovery.state, state, 'replacement state');
  else if (fs.existsSync(recoveryPaths(run.root, entry).root)) throw new Error('attempt is missing its recovery lineage');
  const transactionPath = recovery ? recovery.transactionPath : originalPath;
  const launchRunDir = recovery ? recovery.attemptRoot : run.root;
  if (state.telemetry?.transactionPath !== transactionPath || !inside(state.evidenceDir, run.root)) throw new Error('transaction evidence is outside its sealed run');
  const projections = new Map();
  if (pending && allowReceiptProjections) {
    projections.set(path.join(state.evidenceDir, 'receipt-ack.json'), state.receipt);
    projections.set(path.join(state.evidenceDir, 'handoff-envelope.json'), { ...state.receipt, telemetryLog: state.receipt?.logDestinations?.telemetryLog });
    if (!Array.isArray(state.artifacts) || state.artifacts.length < 5) throw new Error('checkpoint has incomplete evidence');
    for (const item of state.artifacts) {
      assertPlainPath(item.path);
      if (!projections.has(item.path)) {
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
  if (recovery && launch.recoverySha256 !== state.recoverySha256) throw new Error('replacement launch has missing recovery lineage');
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
  if (responseProtocol) validateClaudeResponseLaunch(launch, { historical: true });
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
  const scratchLaunch = entry.vendor === 'openai' && Object.hasOwn(launch, 'scratchPermissions');
  if (scratchLaunch) {
    if (launch.model !== entry.model || launch.effort !== entry.effort) throw new Error('scratch launch model or effort differs from the sealed plan');
    assertPlainPath(path.join(launchRunDir, 'out', entry.dispatchId, 'scratch'));
  }
  const expectedSandbox = entry.vendor === 'openai'
    ? (scratchLaunch ? 'custom permissions' : entry.role === 'implement' ? 'workspace-write' : 'read-only') : undefined;
  const proof = (postRun ? verifyNativeProof : verifyProof)({ vendor: entry.vendor, capture: artifact('capture.txt'), log: artifact('vendor.log'), expectedModel: entry.model, expectedObservedModel: spec.canonical || entry.model, expectedEffort: entry.effort,
    expectedSandbox, launch, runDir: launchRunDir, dispatchId: entry.dispatchId, expectedRole: entry.role, expectedCwd: entry.cwd,
    onTopic: true, responseProtocol });
  const response = finalResponse(entry.vendor, fs.readFileSync(artifact('capture.txt'), 'utf8'), { responseProtocol });
  if (response.split(/\r?\n/, 1)[0] !== fs.readFileSync(entry.brief, 'utf8').split(/\r?\n/, 1)[0]) throw new Error('native response has wrong brief acknowledgement');
  const sessionId = proof.sessionId || proof.conversationId;
  if (recovery && sessionId === recovery.manifest.original.native.sessionId) throw new Error('replacement reused the interrupted native session');
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
  const proofId = hash(JSON.stringify(proof));
  same(readJson(artifact('proof.json')), { proofId, class: entry.class, ...proof }, 'native proof');
  for (const [key, value] of Object.entries({ dispatchId: entry.dispatchId, unitId: entry.unitId, role: entry.role, vendor: entry.vendor, class: entry.class, model: entry.model, effort: entry.effort, proofId, modelRequested: entry.model, modelObserved: proof.modelObserved, planId: run.plan.planId, planHash: run.seal.planHash, escalation: entry.escalation === true, escalationReason: entry.escalationReason || null })) {
    if (state.telemetry[key] !== value || state.receipt[key] !== value) throw new Error(`receipt/telemetry ${key} mismatch`);
  }
  if (state.telemetry.authorVendor !== (entry.authorVendor || null)) throw new Error('telemetry authorVendor mismatch');
  const before = readJson(artifact('workspace-before.json'));
  if (recovery) same(before, recovery.manifest.original.workspace, 'replacement frozen workspace');
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
        let state = readJson(file);
        same(state.entry, entry, 'transaction entry');
        if (state.planHash !== run.seal.planHash) throw new Error('transaction plan hash mismatch');
        const recovery = resolveRecovery(run, entry, state);
        if (recovery) {
          outcome.interruptedAttempt = { status: state.status, transactionPath: file, evidenceDir: state.evidenceDir,
            nativeSessionId: recovery.manifest.original.native.sessionId };
          outcome.recoveryManifestPath = recovery.manifestPath;
          state = recovery.state;
        }
        if (!['PASS', 'FAIL', 'RUNNING', AWAITING_ATTESTATION].includes(state.status)) throw new Error('unknown transaction status');
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
  writeJson(path.join(run.root, 'run-summary.json'), result);
  return result;
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
module.exports = { SEQUENCE_PROTOCOL, assessRun, finalizeRun, inspectRun, interruptedSnapshot, main, nativePosition, resolveRecovery, shouldLinkVault, tallyUnit, validateLogDestinations, verifyCheckpoint, verifyExecution, verifyPrerequisites, verifyRecoveryManifest };
