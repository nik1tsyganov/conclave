#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildLaunch } = require('./cli-adapters.js');
const { runLaunch } = require('./cli-runner.js');
const { FINGERPRINT_V2, stageRules, verifyStagedRules } = require('./cli-rules-stage.js');
const { checkBriefFile } = require('./cli-brief-rules-check.js');
const { verifyNativeProof, verifyProof } = require('./cli-proof.js');
const { validateDispatchRow, ROLES } = require('./dispatch-schema.js');
const { DEFAULT_MATRIX, bindDispatch, loadMatrix, loadAvailability } = require('./dispatch-matrix.js');
const { loadProfiles, buildSeatProfile } = require('./seat-policy.js');
const { stageSeatSkills, verifySeatSkills } = require('./cli-skill-stage.js');
const { DEFAULT_PROFILES } = require('./seat-policy.js');
const { ATTESTATION_PROTOCOL, AWAITING_ATTESTATION, appendUniqueRow, assertPlainPath, compareWorkspace, hashFile, inside, reserveTransaction, runtimeManifest, snapshotWorkspace, transactionKey, writeJson: atomicJson } = require('./dispatch-evidence.js');
const { CLAUDE_RESPONSE_PROTOCOL, finalResponse, nativeLog, validateClaudeResponseLaunch } = require('./vendor-native.js');
const { readSealedRun } = require('./plan-seal.js');
const { SEQUENCE_PROTOCOL, validateLogDestinations, verifyCheckpoint, verifyExecution, verifyPrerequisites } = require('./run-finalize.js');

function argError(message) { const e = new Error(message); e.code = 'ARGUMENT_ERROR'; return e; }
function policyError(message) { const e = new Error(message); e.code = 'POLICY_FAIL'; return e; }
function hashText(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function appendJsonl(file, row) { fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true }); fs.appendFileSync(path.resolve(file), `${JSON.stringify(row)}\n`, 'utf8'); }
function writeJson(file, value) { atomicJson(file, value); }

function parseArgs(argv) {
  const out = { onTopic: false };
  const values = new Set([
    '--vendor', '--role', '--class', '--brief', '--cwd', '--model', '--effort', '--dispatch-id', '--unit-id',
    '--evidence-dir', '--telemetry-log', '--activation-log', '--rules-root', '--review-permission-mode',
    '--matrix', '--availability', '--author-vendor', '--seat-profiles', '--skill-source-root', '--plan', '--plan-hash', '--run-dir', '--max-wall-ms', '--capture-sha256',
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--on-topic') { out.onTopic = true; continue; }
    if (flag === '--help' || flag === '-h') { out.help = true; continue; }
    if (!values.has(flag)) throw argError(`unknown option: ${flag}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw argError(`${flag} requires a value`);
    out[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return out;
}

function usage() {
  return [
    'Usage: node tools/dispatch-run.js --plan <run-dir/dispatch-plan.json> --dispatch-id <id>',
    '  [--run-dir <dir>] [--availability <json>] [--max-wall-ms <milliseconds>]',
    '  [--rules-root <dir>] [--skill-source-root <dir>] [--on-topic --capture-sha256 <checkpoint hash>]',
    '',
    'Runs one fail-closed MAGI CLI seat transaction. Matrix, seat policy, staged skills, rules, proof, and telemetry are enforced in code.',
    'Claude first returns AWAITING_ATTESTATION (ok:false, exit 0). Inspect its response, then attest the same capture hash without relaunching.',
  ].join('\n');
}

function required(opts) {
  for (const key of ['vendor', 'role', 'class', 'brief', 'cwd', 'model', 'effort', 'dispatchId', 'unitId', 'evidenceDir']) {
    if (!opts[key]) throw argError(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
  }
  if (!['openai', 'google', 'anthropic'].includes(opts.vendor)) throw argError('invalid --vendor');
  if (!ROLES.includes(opts.role)) throw argError('invalid --role');
  if (opts.authorVendor && !['openai', 'google', 'anthropic'].includes(opts.authorVendor)) throw argError('invalid --author-vendor');
  if (opts.authorVendor === opts.vendor && (opts.role === 'review' || opts.role === 'verify')) {
    throw policyError(`same-vendor ${opts.role} forbidden: ${opts.vendor} authored ${opts.unitId}`);
  }
}

function seatContractText(opts, seatProfile, skillStage) {
  return [
    '# MAGI CLI seat contract',
    '',
    `Dispatch: ${opts.dispatchId}`,
    `Unit: ${opts.unitId}`,
    `Vendor: ${opts.vendor}`,
    `Role: ${opts.role}`,
    `Class: ${opts.class}`,
    `Model: ${opts.model}`,
    `Effort: ${opts.effort}`,
    `Plan: ${opts.planId} (${opts.planHash})`,
    `Escalation: ${opts.escalation === true}; reason: ${opts.escalationReason || 'none'}`,
    `Permission profile: ${seatProfile.permissionProfile}`,
    '',
    'This is a leaf seat. Do not dispatch, delegate, spawn, or ask another model/agent to perform work.',
    'This seat is not the arbiter. Do not change routing, model choice, panel membership, or deterministic gate outcomes.',
    opts.role === 'implement' ? `Writes are limited to these relative paths in the assigned worktree: ${opts.writeScope.join(', ')}.` : 'Read-only role: do not modify product files.',
    'Do not stage or commit changes. Do not modify any evidence, rules, contracts, or skill files.',
    '',
    'Allowed staged skills:',
    ...seatProfile.skills.map((skill) => `- ${skill}: ${path.join(skillStage.root, skill, 'SKILL.md')}`),
    '',
    `Skill manifest: ${skillStage.manifestPath}`,
    `Required proof fields: ${seatProfile.proofFields.join(', ')}`,
    '',
  ].join('\n');
}

function checkpointResult(state, replayed) {
  return { ok: false, status: AWAITING_ATTESTATION, replayed, planId: state.planId, planHash: state.planHash,
    dispatchId: state.entry.dispatchId, proofId: state.receipt.proofId,
    capturePath: path.join(state.evidenceDir, 'capture.txt'), responsePath: path.join(state.evidenceDir, 'response.txt'),
    captureSha256: state.receipt.captureSha256 };
}

function acceptCheckpoint(run, entry, transaction, captureSha256) {
  if (captureSha256 !== transaction.state.receipt.captureSha256) throw policyError('attestation capture hash does not match the checkpoint');
  verifyCheckpoint(run, entry, transaction.state, { current: true });
  const lock = `${transaction.file}.attestation.lock`;
  assertPlainPath(lock);
  let handle;
  try { handle = fs.openSync(lock, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw policyError('attestation is already in progress; read the dispatch again'); throw error; }
  try {
    const state = JSON.parse(fs.readFileSync(transaction.file, 'utf8'));
    if (state.status === 'PASS') {
      verifyExecution(run, entry, state);
      if (captureSha256 !== state.receipt.captureSha256) throw policyError('attestation capture hash does not match the committed capture');
      return { ok: true, replayed: true, proofId: state.receipt.proofId, receipt: state.receipt, telemetry: state.telemetry };
    }
    const execution = verifyCheckpoint(run, entry, state, { current: true });
    if (captureSha256 !== state.receipt.captureSha256) throw policyError('attestation capture hash does not match the checkpoint');
    const attestationPath = path.join(state.evidenceDir, 'attestation.json');
    if (fs.existsSync(attestationPath)) throw policyError('uncommitted attestation artifact already exists');
    const attestation = { schemaVersion: 1, protocol: ATTESTATION_PROTOCOL, decision: 'ON_TOPIC', planId: state.planId, planHash: state.planHash,
      dispatchId: entry.dispatchId, unitId: entry.unitId, proofId: state.receipt.proofId, captureSha256,
      checkpointSha256: hashFile(path.join(state.evidenceDir, 'checkpoint.json')), acceptedAt: new Date().toISOString() };
    const receipt = { ...state.receipt, status: 'PASS' };
    const telemetry = validateDispatchRow({ ...state.telemetry, status: 'PASS' }, { requireCursorCli: true, requireArbiter: true, requireDispatchId: true, requireUnitId: true, requireProof: true });
    const handoffPath = path.join(state.evidenceDir, 'handoff-envelope.json');
    const { telemetryLog } = JSON.parse(fs.readFileSync(handoffPath, 'utf8'));
    atomicJson(attestationPath, attestation);
    atomicJson(path.join(state.evidenceDir, 'receipt-ack.json'), receipt);
    atomicJson(handoffPath, { ...receipt, telemetryLog });
    const rewritten = [path.join(state.evidenceDir, 'receipt-ack.json'), handoffPath];
    const artifacts = state.artifacts.map(item => rewritten.includes(item.path) ? { ...item, sha256: hashFile(item.path) } : item);
    artifacts.push({ path: attestationPath, sha256: hashFile(attestationPath) });
    for (const log of execution.logs) appendUniqueRow(log, telemetry);
    atomicJson(transaction.file, { ...state, status: 'PASS', receipt, telemetry, artifacts, completedAt: new Date().toISOString() });
    return { ok: true, replayed: false, proofId: receipt.proofId, receipt, telemetry };
  } finally {
    fs.closeSync(handle);
    fs.rmSync(lock);
  }
}

async function runDispatch(opts, dependencies = {}) {
  if (!opts.plan || !opts.dispatchId) throw argError('--plan and --dispatch-id are required');
  const planPath = fs.realpathSync(opts.plan);
  const runDir = path.dirname(planPath);
  if (opts.runDir && fs.realpathSync(opts.runDir) !== runDir) throw policyError('--run-dir does not contain the sealed plan');
  const sealed = readSealedRun(runDir);
  const { seal } = sealed;
  if (planPath !== sealed.planPath) throw policyError('dispatch plan must be the sealed run plan');
  const planEntry = sealed.plan.dispatches.find((row) => row.dispatchId === opts.dispatchId);
  if (!planEntry) throw policyError('dispatchId absent from sealed plan');
  opts = { ...planEntry, planHash: seal.planHash, evidenceDir: path.join(runDir, 'out', opts.dispatchId), ...opts };
  required(opts);
  const originalBrief = path.resolve(opts.brief);
  const evidenceDir = path.resolve(opts.evidenceDir);
  const cwd = fs.realpathSync(opts.cwd);
  if (!inside(evidenceDir, runDir)) throw policyError('evidence directory must be inside its sealed run directory');
  if (inside(evidenceDir, cwd)) throw policyError('evidence directory must be outside the product worktree');
  // Overrides may relocate an identical contract; they cannot weaken runtime policy.
  for (const [supplied, canonical] of [[opts.matrix, DEFAULT_MATRIX], [opts.seatProfiles, DEFAULT_PROFILES]]) {
    if (supplied && hashFile(supplied) !== hashFile(canonical)) throw policyError('runtime policy override differs from installed contract');
  }
  if (opts.availability && hashFile(opts.availability) !== seal.availabilitySha256) {
    throw policyError('availability override differs from sealed evidence');
  }
  const matrix = loadMatrix();
  const availability = loadAvailability(sealed.availablePath);
  const transactionPath = path.join(runDir, '.magi-dispatches', `${transactionKey(planEntry)}.json`);
  assertPlainPath(transactionPath);
  const savedState = fs.existsSync(transactionPath) ? JSON.parse(fs.readFileSync(transactionPath, 'utf8')) : null;
  const postRun = planEntry.vendor === 'anthropic';
  const attesting = postRun && (opts.onTopic === true || opts.captureSha256 !== undefined);
  if (opts.captureSha256 !== undefined && !postRun) throw argError('--capture-sha256 is only for Claude post-run attestation');
  if (attesting) {
    if (opts.onTopic !== true || typeof opts.captureSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(opts.captureSha256)) throw argError('post-run attestation requires --on-topic and --capture-sha256 with a lowercase SHA-256');
    if (!savedState || ![AWAITING_ATTESTATION, 'PASS'].includes(savedState.status) || savedState.attestationProtocol !== ATTESTATION_PROTOCOL) throw policyError('post-run attestation requires an existing Claude checkpoint; premature attestation cannot launch a child');
    if (savedState.receipt?.captureSha256 !== opts.captureSha256) throw policyError('attestation capture hash does not match the checkpoint');
  }
  // A finished Claude child keeps its proven launch-time availability. This path never launches.
  const resumeAt = postRun && savedState?.attestationProtocol === ATTESTATION_PROTOCOL && [AWAITING_ATTESTATION, 'PASS'].includes(savedState.status) ? Date.parse(savedState.startedAt) : undefined;
  const binding = bindDispatch(opts, matrix, availability, resumeAt);
  if (inside(binding.planPath, cwd)) throw policyError('dispatch plan must be outside the product worktree');
  opts = { ...opts, ...binding.entry, cwd, planHash: binding.planHash, planId: binding.plan.planId };
  const telemetryLog = path.resolve(opts.telemetryLog || path.join(runDir, 'telemetry', 'dispatches.jsonl'));
  const activationLog = path.resolve(opts.activationLog || path.join(runDir, 'magi-dispatch-log.jsonl'));
  if ([telemetryLog, activationLog].some((file) => !inside(file, runDir) || inside(file, cwd))) throw policyError('dispatch logs must be inside the run directory and outside the product worktree');
  for (const file of [telemetryLog, activationLog, evidenceDir]) assertPlainPath(file);
  validateLogDestinations(sealed, [telemetryLog, activationLog], evidenceDir, [DEFAULT_MATRIX, DEFAULT_PROFILES, ...[opts.rulesRoot, opts.skillSourceRoot].filter(Boolean)]);
  const prerequisites = fs.existsSync(transactionPath) ? null : verifyPrerequisites(sealed, binding.entry,
    ['review', 'verify'].includes(opts.role) ? snapshotWorkspace(cwd) : undefined, new Date().toISOString());
  const transaction = reserveTransaction(binding, evidenceDir, postRun ? ATTESTATION_PROTOCOL : undefined);
  const responseProtocol = opts.vendor === 'anthropic' ? CLAUDE_RESPONSE_PROTOCOL : undefined;
  if (transaction.pending) {
    if (attesting) return acceptCheckpoint(sealed, binding.entry, transaction, opts.captureSha256);
    verifyCheckpoint(sealed, binding.entry, transaction.state);
    return checkpointResult(transaction.state, true);
  }
  if (transaction.replayed) {
    verifyExecution(sealed, binding.entry, transaction.state);
    return { ok: true, replayed: true, proofId: transaction.state.telemetry.proofId, receipt: transaction.state.receipt, telemetry: transaction.state.telemetry };
  }
  let scopeAudit = null;
  let before = null;
  let evidenceCreated = false;
  try {
  if (fs.existsSync(evidenceDir) && fs.readdirSync(evidenceDir).length) throw policyError('evidence directory must be new or empty');
  fs.mkdirSync(evidenceDir, { recursive: true });
  evidenceCreated = true;
  if (inside(fs.realpathSync(evidenceDir), cwd)) throw policyError('evidence directory resolves inside the product worktree');
  const brief = path.join(evidenceDir, 'brief', 'BRIEF.md');
  fs.mkdirSync(path.dirname(brief), { recursive: true });
  fs.copyFileSync(originalBrief, brief);
  const seatProfiles = loadProfiles();
  const seatProfile = buildSeatProfile(seatProfiles, { vendor: opts.vendor, role: opts.role, class: opts.class, arbiter: false, subdispatch: false });
  const skillStage = stageSeatSkills({
    skills: seatProfile.skills,
    sourceRoot: opts.skillSourceRoot,
    destinationRoot: path.join(evidenceDir, 'skills'),
  });
  writeJson(path.join(evidenceDir, 'seat-profile.json'), seatProfile);
  const seatContractPath = path.join(evidenceDir, 'SEAT-CONTRACT.md');
  fs.writeFileSync(seatContractPath, seatContractText(opts, seatProfile, skillStage), 'utf8');

  const staged = stageRules({ briefPath: brief, rulesRoot: opts.rulesRoot });
  if (staged.manifest.fingerprint !== FINGERPRINT_V2) throw policyError('production dispatch requires the external STANDING v2 / R01-R22 pack');
  verifyStagedRules(brief);
  const briefCheck = checkBriefFile(brief, { role: opts.role, vendor: opts.vendor, requireStructural: true, seatProfile, skillRoot: skillStage.root, seatContractPath, expectedRulesManifest: staged.manifest, expectedSkillsManifest: skillStage.manifest });
  if (!briefCheck.ok) {
    const error = new Error(`brief gate failed: ${briefCheck.missing.join(', ')}`);
    error.code = 'RULES_FAIL';
    throw error;
  }

  const capturePath = path.join(evidenceDir, 'capture.txt');
  const stdoutPath = path.join(evidenceDir, 'stdout.log');
  const stderrPath = path.join(evidenceDir, 'stderr.log');
  const pidFile = path.join(evidenceDir, 'child.pid');
  for (const file of [capturePath, stdoutPath, stderrPath]) fs.rmSync(file, { force: true });

  const launch = (dependencies.buildLaunch || buildLaunch)({
    vendor: opts.vendor, role: opts.role, briefPath: brief, cwd: opts.cwd, model: opts.model,
    effort: opts.vendor === 'google' ? undefined : opts.effort,
    capturePath, skillRoot: skillStage.root, seatContractPath,
    reviewPermissionMode: opts.reviewPermissionMode,
    responseProtocol,
  });
  if (responseProtocol) validateClaudeResponseLaunch(launch);
  if (launch.nativeLogPath) {
    if (!inside(launch.nativeLogPath, evidenceDir)) throw new Error('native log must stay inside dispatch evidence');
    assertPlainPath(launch.nativeLogPath);
    fs.rmSync(launch.nativeLogPath, { force: true });
  }
  const runtimeFiles = runtimeManifest();
  const runtimeSha256 = hashText(JSON.stringify(runtimeFiles));
  atomicJson(path.join(evidenceDir, 'runtime-manifest.json'), runtimeFiles);
  const launchPath = path.join(evidenceDir, 'launch.json');
  writeJson(launchPath, {
    class: opts.class, vendor: launch.vendor, role: launch.role, model: opts.model, effort: opts.effort,
    planId: opts.planId, planHash: opts.planHash, planEntry: binding.entry, escalation: opts.escalation === true, escalationReason: opts.escalationReason || null,
    binary: launch.binary, args: launch.args, cwd: launch.cwd, nativeLogPath: launch.nativeLogPath,
    responseProtocol,
    ...(postRun ? { attestationProtocol: ATTESTATION_PROTOCOL, logDestinations: { telemetryLog, activationLog } } : {}),
    sequenceProtocol: SEQUENCE_PROTOCOL, startedAt: transaction.state.startedAt, prerequisites,
    matrixVersion: matrix.schemaVersion, seatProfileVersion: seatProfiles.schemaVersion,
    seatContractPath, skillManifestPath: skillStage.manifestPath, runtimeSha256,
  });

  const protectedPaths = [binding.planPath, sealed.sealPath, sealed.availablePath, originalBrief, DEFAULT_MATRIX, DEFAULT_PROFILES, brief, seatContractPath, staged.manifestPath, skillStage.manifestPath, path.join(evidenceDir, 'seat-profile.json'), launchPath,
    ...Object.entries(skillStage.manifest.skills).flatMap(([skill, files]) => files.map((file) => path.join(skillStage.root, skill, file.path))),
    ...staged.manifest.files.map((item) => path.join(path.dirname(brief), item.path))];
  const protectedHashes = protectedPaths.map((file) => ({ path: file, sha256: hashFile(file) }));
  validateLogDestinations(sealed, [telemetryLog, activationLog], evidenceDir, [...protectedPaths, staged.rulesRoot, skillStage.manifest.sourceRoot]);
  atomicJson(path.join(evidenceDir, 'plan-binding.json'), { planId: opts.planId, planHash: opts.planHash, entry: binding.entry });
  before = snapshotWorkspace(cwd);
  if (JSON.stringify(prerequisites) !== JSON.stringify(verifyPrerequisites(sealed, binding.entry, before, transaction.state.startedAt))) throw policyError('sequence prerequisites changed before launch');
  atomicJson(path.join(evidenceDir, 'workspace-before.json'), before);
  const rulesBefore = snapshotWorkspace(staged.rulesRoot);
  atomicJson(path.join(evidenceDir, 'rules-source-before.json'), rulesBefore);
  const skillSources = () => Object.fromEntries(seatProfile.skills.map((skill) => [skill, snapshotWorkspace(path.join(skillStage.manifest.sourceRoot, skill))]));
  const skillsBefore = skillSources();
  atomicJson(path.join(evidenceDir, 'skills-source-before.json'), skillsBefore);
  const maxWallMs = opts.maxWallMs === undefined ? 2700000 : Number(opts.maxWallMs);
  if (!Number.isFinite(maxWallMs) || maxWallMs < 1 || maxWallMs > 2700000) throw argError('--max-wall-ms must be between 1 and 2700000');
  const result = await (dependencies.runLaunch || runLaunch)(launch, { pidFile, stdoutFile: stdoutPath, stderrFile: stderrPath, maxWallMs, signal: dependencies.signal });
  for (const file of [telemetryLog, activationLog, capturePath, path.join(evidenceDir, 'vendor.log'), transaction.file, path.join(runDir, '.magi-sessions'), ...(launch.nativeLogPath ? [launch.nativeLogPath] : [])]) assertPlainPath(file);
  const after = snapshotWorkspace(cwd);
  atomicJson(path.join(evidenceDir, 'workspace-after.json'), after);
  scopeAudit = compareWorkspace(before, after, opts.writeScope);
  atomicJson(path.join(evidenceDir, 'scope-audit.json'), scopeAudit);
  const rulesAfter = snapshotWorkspace(staged.rulesRoot);
  atomicJson(path.join(evidenceDir, 'rules-source-after.json'), rulesAfter);
  const rulesAudit = compareWorkspace(rulesBefore, rulesAfter, []);
  atomicJson(path.join(evidenceDir, 'rules-source-audit.json'), rulesAudit);
  const skillsAfter = skillSources();
  atomicJson(path.join(evidenceDir, 'skills-source-after.json'), skillsAfter);
  const skillsAudit = Object.fromEntries(seatProfile.skills.map((skill) => [skill, compareWorkspace(skillsBefore[skill], skillsAfter[skill], [])]));
  atomicJson(path.join(evidenceDir, 'skills-source-audit.json'), skillsAudit);
  if (opts.vendor !== 'openai') fs.writeFileSync(capturePath, result.stdout, 'utf8');
  let combinedLog = opts.vendor === 'openai' ? result.stderr : `${result.stderr}\n${result.stdout}`;
  if (result.ok && fs.existsSync(capturePath) && !dependencies.runLaunch) combinedLog = nativeLog(opts.vendor, fs.readFileSync(capturePath, 'utf8'), combinedLog, { cwd, nativeLogPath: launch.nativeLogPath });
  fs.writeFileSync(path.join(evidenceDir, 'vendor.log'), combinedLog, 'utf8');
  if (!result.ok) throw Object.assign(new Error(`vendor child failed exit=${result.exitCode}${result.killReason ? ` reason=${result.killReason}` : ''}`), { code: 'LAUNCH_FAIL' });
  if (!scopeAudit.ok) throw Object.assign(new Error('vendor changed files outside its authorized scope or changed git state'), { code: 'SCOPE_FAIL' });
  if (!rulesAudit.ok || hashText(JSON.stringify(runtimeManifest())) !== runtimeSha256) throw policyError('external rules source or runtime code changed during dispatch');
  if (Object.values(skillsAudit).some((audit) => !audit.ok)) throw policyError('external skill source changed during dispatch');
  if (opts.role === 'implement' && scopeAudit.changedFiles.length === 0) throw Object.assign(new Error('implementation produced no covered file change'), { code: 'SCOPE_FAIL' });
  for (const file of protectedHashes) if (hashFile(file.path) !== file.sha256) throw policyError(`protected input changed during dispatch: ${file.path}`);
  if (JSON.stringify(prerequisites) !== JSON.stringify(verifyPrerequisites(sealed, binding.entry, before, transaction.state.startedAt))) throw policyError('sequence prerequisites changed during dispatch');
  verifyStagedRules(brief, staged.manifest);
  verifySeatSkills({ destinationRoot: skillStage.root, skills: seatProfile.skills, manifest: skillStage.manifest });
  if (!fs.existsSync(capturePath) || !fs.readFileSync(capturePath, 'utf8').trim()) throw Object.assign(new Error('vendor capture missing or empty'), { code: 'PROOF_FAIL' });
  const modelSpec = matrix.vendors[opts.vendor].models[opts.model];
  const proof = (postRun ? verifyNativeProof : verifyProof)({ vendor: opts.vendor, capture: capturePath, log: path.join(evidenceDir, 'vendor.log'), expectedModel: opts.model, expectedObservedModel: modelSpec.canonical || opts.model, expectedEffort: opts.effort, expectedSandbox: launch.requestedSandbox, onTopic: opts.onTopic, responseProtocol });
  const response = finalResponse(opts.vendor, fs.readFileSync(capturePath, 'utf8'), { responseProtocol });
  const firstLine = fs.readFileSync(brief, 'utf8').split(/\r?\n/, 1)[0];
  if (response.split(/\r?\n/, 1)[0] !== firstLine) throw Object.assign(new Error('final response does not acknowledge the bound brief first line'), { code: 'PROOF_FAIL' });
  if (postRun) proof.attestationProtocol = ATTESTATION_PROTOCOL;
  Object.assign(proof, { planId: opts.planId, planHash: opts.planHash, escalation: opts.escalation === true, escalationReason: opts.escalationReason || null });
  for (const field of seatProfile.proofFields) {
    // Subjective topicality is fulfilled by the later bound attestation, never native parsing.
    if (postRun && field === 'onTopic') continue;
    if (proof[field] === undefined || proof[field] === null) {
      const error = new Error(`seat proof missing required field: ${field}`);
      error.code = 'PROOF_FAIL';
      throw error;
    }
  }
  const proofId = hashText(JSON.stringify(proof));
  const sessionKey = `${opts.vendor}-${hashText(proof.sessionId || proof.conversationId || '')}`;
  const sessionDir = path.join(runDir, '.magi-sessions');
  fs.mkdirSync(sessionDir, { recursive: true });
  try { fs.writeFileSync(path.join(sessionDir, `${sessionKey}.json`), JSON.stringify({ dispatchId: opts.dispatchId, proofId }), { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') throw policyError('native session already belongs to another dispatch'); throw error; }
  writeJson(path.join(evidenceDir, 'proof.json'), { proofId, class: opts.class, ...proof });

  const now = new Date();
  const telemetry = validateDispatchRow({
    schemaVersion: 2, status: 'PASS', date: now.toISOString().slice(0, 10), dispatchId: opts.dispatchId, unitId: opts.unitId,
    class: opts.class, vendor: opts.vendor, role: opts.role, hostMode: 'cursor-cli', routedBy: 'arbiter', capturedBy: 'lead',
    model: opts.model, modelRequested: opts.model, modelObserved: proof.modelObserved, effort: opts.effort, proofId, vendorSideTokens: proof.vendorSideTokens ?? null,
    authorVendor: opts.authorVendor || null, planId: opts.planId, planHash: opts.planHash, escalation: opts.escalation === true, escalationReason: opts.escalationReason || null,
    transactionPath: transaction.file,
    note: `evidence=${evidenceDir};matrix=v${matrix.schemaVersion};seat-profile=v${seatProfiles.schemaVersion}`,
  }, { requireCursorCli: true, requireArbiter: true, requireDispatchId: true, requireUnitId: true, requireProof: true });

  const receipt = {
    schemaVersion: 2, status: 'PASS', dispatchId: opts.dispatchId, unitId: opts.unitId, class: opts.class, vendor: opts.vendor, role: opts.role,
    model: opts.model, effort: opts.effort, proofId, matrixVersion: matrix.schemaVersion, seatProfileVersion: seatProfiles.schemaVersion,
    seatSkills: seatProfile.skills, permissionProfile: seatProfile.permissionProfile,
    planId: opts.planId, planHash: opts.planHash, planEntry: binding.entry, transactionPath: transaction.file,
    modelRequested: opts.model, modelObserved: proof.modelObserved, escalation: opts.escalation === true, escalationReason: opts.escalationReason || null,
    changedFiles: scopeAudit.changedFiles, scopeCoverage: scopeAudit.coverage, runtimeSha256,
    briefSha256: crypto.createHash('sha256').update(fs.readFileSync(brief)).digest('hex'),
    captureSha256: crypto.createHash('sha256').update(fs.readFileSync(capturePath)).digest('hex'),
    seatContractSha256: crypto.createHash('sha256').update(fs.readFileSync(seatContractPath)).digest('hex'),
    skillsManifestSha256: crypto.createHash('sha256').update(fs.readFileSync(skillStage.manifestPath)).digest('hex'),
    rulesManifest: staged.manifestPath, completedAt: now.toISOString(),
    ...(postRun ? { attestationProtocol: ATTESTATION_PROTOCOL, logDestinations: { telemetryLog, activationLog } } : {}),
  };
  if (postRun) { receipt.status = AWAITING_ATTESTATION; telemetry.status = AWAITING_ATTESTATION; }
  writeJson(path.join(evidenceDir, 'receipt-ack.json'), receipt);
  writeJson(path.join(evidenceDir, 'handoff-envelope.json'), { ...receipt, telemetryLog });
  const artifacts = ['capture.txt', 'vendor.log', 'proof.json', 'receipt-ack.json', 'handoff-envelope.json', 'scope-audit.json', 'plan-binding.json', 'launch.json', 'workspace-before.json', 'workspace-after.json', 'runtime-manifest.json', 'rules-source-before.json', 'rules-source-after.json', 'rules-source-audit.json', 'skills-source-before.json', 'skills-source-after.json', 'skills-source-audit.json']
    .map((file) => ({ path: path.join(evidenceDir, file), sha256: hashFile(path.join(evidenceDir, file)) }));
  artifacts.push(...protectedHashes.filter(file => !artifacts.some(item => item.path === file.path)));
  if (launch.nativeLogPath && fs.existsSync(launch.nativeLogPath)) artifacts.push({ path: launch.nativeLogPath, sha256: hashFile(launch.nativeLogPath) });
  const logs = [...new Set([telemetryLog, activationLog])];
  if (postRun) {
    fs.writeFileSync(path.join(evidenceDir, 'response.txt'), response, 'utf8');
    atomicJson(path.join(evidenceDir, 'checkpoint.json'), { schemaVersion: 1, status: AWAITING_ATTESTATION, protocol: ATTESTATION_PROTOCOL,
      planId: opts.planId, planHash: opts.planHash, dispatchId: opts.dispatchId, unitId: opts.unitId, proofId,
      captureSha256: receipt.captureSha256, responseSha256: hashText(response), completedAt: receipt.completedAt, logDestinations: receipt.logDestinations,
      protectedInputs: protectedHashes, recordedAt: new Date().toISOString() });
    for (const name of ['response.txt', 'checkpoint.json']) artifacts.push({ path: path.join(evidenceDir, name), sha256: hashFile(path.join(evidenceDir, name)) });
    const state = { ...transaction.state, status: AWAITING_ATTESTATION, receipt, telemetry, artifacts, logs, completedAt: new Date().toISOString() };
    atomicJson(transaction.file, state);
    return checkpointResult(state, false);
  }
  for (const log of logs) appendUniqueRow(log, telemetry);
  // This commit marker is written last. Consumers reject incomplete projections.
  atomicJson(transaction.file, { ...transaction.state, status: 'PASS', receipt, telemetry, artifacts, logs, completedAt: new Date().toISOString() });
  return { ok: true, proofId, receipt, telemetry };
  } catch (error) {
    if (before && !scopeAudit) {
      try { scopeAudit = compareWorkspace(before, snapshotWorkspace(cwd), opts.writeScope); } catch (auditError) { scopeAudit = { ok: false, error: auditError.message }; }
    }
    const failure = { ...transaction.state, status: 'FAIL', code: error.code || 'DISPATCH_FAIL', error: error.message, scopeAudit, completedAt: new Date().toISOString() };
    atomicJson(transaction.file, failure);
    // Failed records never qualify for activation or successful usage accounting.
    if (evidenceCreated) {
      atomicJson(path.join(evidenceDir, 'receipt-ack.json'), failure);
      atomicJson(path.join(evidenceDir, 'handoff-envelope.json'), failure);
    }
    throw error;
  }
}

async function main(argv = process.argv.slice(2), io = process) {
  try {
    const opts = parseArgs(argv);
    if (opts.help) { io.stdout.write(`${usage()}\n`); return 0; }
    const result = await runDispatch(opts);
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const code = error.code || 'DISPATCH_FAIL';
    io.stderr.write(`${code}: ${error.message}\n`);
    return ['ARGUMENT_ERROR', 'BINARY_MISSING', 'RULES_SOURCE_MISSING', 'SKILL_STAGE_FAIL'].includes(code) ? 2 : 1;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });
module.exports = { appendJsonl, main, parseArgs, runDispatch, seatContractText };
