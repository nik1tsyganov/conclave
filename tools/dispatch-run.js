#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { GOOGLE_CAPTURE_EVENTS, SYNARA_CAPTURE_TRUST, allowedWorkspace, buildLaunch } = require('./cli-adapters.js');
const { runLaunch } = require('./cli-runner.js');
const { DEFAULT_RULES_ROOT, FINGERPRINT_V2, prepareRulesSource, stageRules, verifyStagedRules } = require('./cli-rules-stage.js');
const { checkBriefFile } = require('./cli-brief-rules-check.js');
const { verifyNativeProof, verifyProof } = require('./cli-proof.js');
const { validateDispatchRow, ROLES } = require('./dispatch-schema.js');
const { DEFAULT_MATRIX, bindDispatch, loadAvailability } = require('./dispatch-matrix.js');
const { loadProfiles, buildSeatProfile } = require('./seat-policy.js');
const { prepareSeatSkills, stageSeatSkills, verifySeatSkills, verifySkillSource } = require('./cli-skill-stage.js');
const { DEFAULT_PROFILES } = require('./seat-policy.js');
const { ATTESTATION_PROTOCOL, AWAITING_ATTESTATION, RECOVERY_PROTOCOL, appendUniqueRow, assertPlainPath, assertInterruptedChildStopped, compareWorkspace, hashFile, inside, recoveryPaths, reserveTransaction, runtimeManifest, snapshotWorkspace, transactionKey, writeJson: atomicJson } = require('./dispatch-evidence.js');
const { CLAUDE_RESPONSE_PROTOCOL, codexSessionTranscript, googleSessionTranscript, finalResponse, nativeLog, validateClaudeResponseLaunch } = require('./vendor-native.js');
const { INSTRUCTION_READ_PROTOCOL, verifyInstructionReadEvidence } = require('./instruction-read-evidence.js');
const { readSealedRun } = require('./plan-seal.js');
const { validateEvidenceReadDirs, snapshotEvidenceReads, validateEvidenceReadLaunch } = require('./evidence-read-access.js');
const { launchOverlay, loadCatalog } = require('./synara-catalog.js');
const { resolveRulesRoot } = require('./runtime-paths.js');
const { SEQUENCE_PROTOCOL, failedRecoverySnapshot, interruptedSnapshot, resolveRecovery, validateLogDestinations, verifyCheckpoint, verifyExecution, verifyPrerequisites, verifyRecoveryManifest } = require('./run-finalize.js');

function argError(message) { const e = new Error(message); e.code = 'ARGUMENT_ERROR'; return e; }
function policyError(message) { const e = new Error(message); e.code = 'POLICY_FAIL'; return e; }
function hashText(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function appendJsonl(file, row) { fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true }); fs.appendFileSync(path.resolve(file), `${JSON.stringify(row)}\n`, 'utf8'); }
function writeJson(file, value) { atomicJson(file, value); }

function parseArgs(argv) {
  const out = { onTopic: false };
  const seen = new Set();
  const values = new Set([
    '--vendor', '--role', '--class', '--brief', '--cwd', '--model', '--effort', '--dispatch-id', '--unit-id',
    '--evidence-dir', '--telemetry-log', '--activation-log', '--rules-root', '--review-permission-mode',
    '--matrix', '--availability', '--author-vendor', '--seat-profiles', '--skill-source-root', '--plan', '--plan-hash', '--run-dir', '--max-wall-ms', '--capture-sha256',
    '--prepare-recovery', '--recover-interrupted', '--recovery-sha256', '--recovery-attempt',
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (seen.has(flag)) throw argError(`duplicate option: ${flag}`);
    seen.add(flag);
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
    '  [--prepare-recovery <new request.json> --availability <fresh probes.json> [--recovery-attempt 2]]',
    '  [--recover-interrupted <request.json> --recovery-sha256 <inspected SHA-256>]',
    '',
    'Runs one fail-closed MAGI CLI seat transaction. Matrix, seat policy, staged skills, rules, proof, and telemetry are enforced in code.',
    'Claude first returns AWAITING_ATTESTATION (ok:false, exit 0). Inspect its response, then attest the same capture hash without relaunching.',
    'Recovery preserves a stopped OpenAI read-only attempt. Explicit attempt 2 requires a completed clean failed first replacement and a later probe. Other plan entries must be committed PASS.',
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

function seatContractText(opts, seatProfile, skillStage, ruleStage) {
  const contractPath = path.join(opts.evidenceDir || path.dirname(skillStage.root), 'SEAT-CONTRACT.md');
  const instructionFiles = [path.join(ruleStage.briefDir, 'BRIEF.md'), contractPath,
    ruleStage.manifestPath, ...ruleStage.manifest.files.map(file => path.join(ruleStage.briefDir, file.path)),
    skillStage.manifestPath, ...seatProfile.skills.map(skill => path.join(skillStage.root, skill, 'SKILL.md'))];
  const openaiReadRecipe = file => `const r = await tools.exec_command(${JSON.stringify({ cmd: `Get-Content -Raw -LiteralPath '${file.replaceAll('\\', '/').replaceAll("'", "''")}' -Encoding UTF8`, max_output_tokens: 10000 })}); text(r.output);`;
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
    ...(opts.vendor === 'openai' && opts.role !== 'implement' && opts.evidenceDir
      ? [`Disposable test files are authorized only under ${path.join(opts.evidenceDir, 'scratch')}. TEMP and TMP point there. This exception does not permit changing product files or sibling evidence.`]
      : []),
    'Do not stage or commit changes. Do not modify any evidence, rules, contracts, or skill files.',
    ...(Array.isArray(opts.evidenceReadDirs) && opts.evidenceReadDirs.length
      ? ['Additional host-helper read directories (not MAGI votes, never a POSITION):', ...opts.evidenceReadDirs.map(dir => `- ${dir}`), 'These evidence directories are frozen inputs. Do not change, create or delete their contents.']
      : []),
    '',
    'Required staged instructions: read these files in full before task work:',
    `- STANDING.md: ${path.join(ruleStage.briefDir, 'STANDING.md')}`,
    `- VENDOR.md: ${path.join(ruleStage.briefDir, 'VENDOR.md')}`,
    `- RULES/INDEX.md: ${path.join(ruleStage.stagedRules, 'INDEX.md')}`,
    `Rules manifest: ${ruleStage.manifestPath}`,
    `Skill manifest: ${skillStage.manifestPath}`,
    '',
    'Read every indexed rule file, including all R01-R22 rules, in full before task work.',
    `Resolve relative instruction paths such as STANDING.md, VENDOR.md and RULES/... against the staged brief directory: ${ruleStage.briefDir}`,
    `Resolve relative links in RULES/INDEX.md and rule files against the staged rule directory: ${ruleStage.stagedRules}`,
    'Do not resolve instruction paths against the product working directory.',
    `Resolve task and product paths against the assigned worktree unless the brief specifies otherwise: ${opts.cwd}`,
    'If any required instruction file is missing or unreadable, stop task work and report a blocker with its absolute path. Never waive a required read.',
    '',
    'Required staged skills: read every listed SKILL.md in full before task work.',
    'Allowed staged skills:',
    ...seatProfile.skills.map((skill) => `- ${skill}: ${path.join(skillStage.root, skill, 'SKILL.md')}`),
    '',
    ...(opts.vendor === 'openai' ? [
      'Native instruction-read evidence is mandatory before task tools or product work.',
      'The first tool call reads this contract with the exact code-mode recipe from the pointer. That read counts; do not repeat it.',
      'Then use ONE functions.exec invocation per code block below, in order. Do not batch calls, add code, change tools, or read global skills before coverage is complete.',
      'A failed or truncated read is a blocker. The runtime checks returned native bytes and model-facing output, not your ACK or claimed read list.',
      ...instructionFiles.filter(file => file !== contractPath).flatMap(file => [file, '```javascript', openaiReadRecipe(file), '```', '']),
    ] : [
      'Complete all required reads with native file-read tools before any other task tool, source read, or product work. Do not inspect global skills or list directories first.',
      'Native full-file content and successful tool results are required. A claimed read list or ACK alone cannot pass.',
    ]),
    `Required proof fields: ${seatProfile.proofFields.join(', ')}`,
    ...(['verify', 'review'].includes(opts.role) ? ['',
      'End your response with exactly one final POSITION: APPROVE, POSITION: REJECT, or POSITION: ABSTAIN line.',
      'Do not include any other POSITION line. State the evidence and blockers before the final POSITION line.'] : []),
    '',
  ].join('\n');
}

function checkpointResult(state, replayed) {
  return { ok: false, status: AWAITING_ATTESTATION, replayed, planId: state.planId, planHash: state.planHash,
    dispatchId: state.entry.dispatchId, proofId: state.receipt.proofId,
    capturePath: path.join(state.evidenceDir, 'capture.txt'), responsePath: path.join(state.evidenceDir, 'response.txt'),
    captureSha256: state.receipt.captureSha256 };
}

function recoverAttestation(run, entry, state, captureSha256) {
  const directory = state.evidenceDir;
  const attestationPath = path.join(directory, 'attestation.json');
  if (!fs.existsSync(attestationPath)) return null;
  assertPlainPath(attestationPath);
  if (state.status !== AWAITING_ATTESTATION || !inside(directory, run.root) || run.plan.dispatches.some(row => inside(directory, row.cwd))) throw policyError('invalid interrupted attestation directory');
  const checkpointPath = path.join(directory, 'checkpoint.json');
  const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  const attestation = JSON.parse(fs.readFileSync(attestationPath, 'utf8'));
  const { acceptedAt, ...binding } = attestation;
  const expected = { schemaVersion: 1, protocol: ATTESTATION_PROTOCOL, decision: 'ON_TOPIC', planId: state.planId, planHash: state.planHash,
    dispatchId: entry.dispatchId, unitId: entry.unitId, proofId: state.receipt.proofId, captureSha256, checkpointSha256: hashFile(checkpointPath) };
  if (JSON.stringify(binding) !== JSON.stringify(expected) || !Number.isFinite(Date.parse(acceptedAt)) || !Number.isFinite(Date.parse(checkpoint.recordedAt)) ||
      Date.parse(acceptedAt) < Date.parse(checkpoint.recordedAt) || Date.parse(acceptedAt) > Date.now()) throw policyError('uncommitted attestation does not match the protected checkpoint');
  const receiptPath = path.join(directory, 'receipt-ack.json');
  const handoffPath = path.join(directory, 'handoff-envelope.json');
  const telemetryLog = state.receipt.logDestinations?.telemetryLog;
  const projections = new Map([[receiptPath, state.receipt], [handoffPath, { ...state.receipt, telemetryLog }]]);
  const restores = [];
  // Only the two deterministic receipt projections may differ. Their original bytes
  // must still match the authoritative pending transaction's recorded hashes.
  for (const [file, pending] of projections) {
    assertPlainPath(file);
    const text = `${JSON.stringify(pending, null, 2)}\n`;
    const items = state.artifacts.filter(item => item.path === file);
    if (items.length !== 1 || items[0].sha256 !== hashText(text)) throw policyError('interrupted attestation has no original receipt binding');
    const current = fs.readFileSync(file, 'utf8');
    const completed = `${JSON.stringify({ ...pending, status: 'PASS' }, null, 2)}\n`;
    if (current !== text && current !== completed) throw policyError('interrupted attestation receipt changed unexpectedly');
    if (current !== text) restores.push([file, pending]);
  }
  for (const item of state.artifacts) {
    assertPlainPath(item.path);
    if (item.path === attestationPath || (!projections.has(item.path) && hashFile(item.path) !== item.sha256)) throw policyError('protected checkpoint evidence changed during interrupted attestation');
  }
  validateLogDestinations(run, state.logs, directory, state.artifacts.map(item => item.path));
  // Validate the complete checkpoint without writes, treating only these exact
  // receipt projections as pending. Restore nothing until every check passes.
  verifyCheckpoint(run, entry, state, { current: true, allowReceiptProjections: true });
  for (const [file, pending] of restores) atomicJson(file, pending);
  return attestation;
}

function acceptCheckpoint(run, entry, transaction, captureSha256) {
  if (captureSha256 !== transaction.state.receipt.captureSha256) throw policyError('attestation capture hash does not match the checkpoint');
  if (!fs.existsSync(path.join(transaction.state.evidenceDir, 'attestation.json'))) verifyCheckpoint(run, entry, transaction.state, { current: true });
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
    const recovered = recoverAttestation(run, entry, state, captureSha256);
    const execution = verifyCheckpoint(run, entry, state, { current: true });
    if (captureSha256 !== state.receipt.captureSha256) throw policyError('attestation capture hash does not match the checkpoint');
    const attestationPath = path.join(state.evidenceDir, 'attestation.json');
    const attestation = recovered || { schemaVersion: 1, protocol: ATTESTATION_PROTOCOL, decision: 'ON_TOPIC', planId: state.planId, planHash: state.planHash,
      dispatchId: entry.dispatchId, unitId: entry.unitId, proofId: state.receipt.proofId, captureSha256,
      checkpointSha256: hashFile(path.join(state.evidenceDir, 'checkpoint.json')), acceptedAt: new Date().toISOString() };
    const receipt = { ...state.receipt, status: 'PASS' };
    const telemetry = validateDispatchRow({ ...state.telemetry, status: 'PASS' }, { requireCursorCli: true, requireArbiter: true, requireDispatchId: true, requireUnitId: true, requireProof: true });
    const handoffPath = path.join(state.evidenceDir, 'handoff-envelope.json');
    const { telemetryLog } = JSON.parse(fs.readFileSync(handoffPath, 'utf8'));
    if (!recovered) atomicJson(attestationPath, attestation);
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
  const maxWallMs = opts.maxWallMs === undefined ? 2700000 : Number(opts.maxWallMs);
  if (!Number.isSafeInteger(maxWallMs) || maxWallMs < 1 || maxWallMs > 2700000) throw argError('--max-wall-ms must be an integer between 1 and 2700000');
  const planPath = fs.realpathSync(opts.plan);
  const runDir = path.dirname(planPath);
  if (opts.runDir && fs.realpathSync(opts.runDir) !== runDir) throw policyError('--run-dir does not contain the sealed plan');
  const sealed = readSealedRun(runDir);
  const { seal } = sealed;
  if (seal.instructionReadProtocol !== INSTRUCTION_READ_PROTOCOL) throw Object.assign(new Error('historical run has no native instruction-read assurance; inspect its original evidence with the matching runtime or seal a new run'), { code: 'INSTRUCTION_READ_COMPATIBILITY_FAIL' });
  if (planPath !== sealed.planPath) throw policyError('dispatch plan must be the sealed run plan');
  const planEntry = sealed.plan.dispatches.find((row) => row.dispatchId === opts.dispatchId);
  if (!planEntry) throw policyError('dispatchId absent from sealed plan');
  if (opts.prepareRecovery && opts.recoverInterrupted) throw argError('prepare-recovery and recover-interrupted are mutually exclusive');
  if (opts.recoverySha256 && !opts.recoverInterrupted) throw argError('recovery-sha256 requires recover-interrupted');
  if (opts.recoveryAttempt !== undefined && (!opts.prepareRecovery || !['1', '2'].includes(String(opts.recoveryAttempt)))) throw argError('recovery-attempt requires prepare-recovery and ordinal 1 or 2');
  const recoveryRequested = Boolean(opts.prepareRecovery || opts.recoverInterrupted);
  let recovery = null;
  if (recoveryRequested) {
    if (opts.onTopic || opts.captureSha256 || opts.evidenceDir) throw argError('recovery cannot override evidence or attestation options');
    bindDispatch({ ...planEntry, ...opts, planHash: seal.planHash }, sealed.matrix, loadAvailability(sealed.availablePath), Date.parse(seal.sealedAt));
    allowedWorkspace(fs.realpathSync(planEntry.cwd), dependencies.env || process.env);
    let paths = recoveryPaths(runDir, planEntry, Number(opts.recoveryAttempt || 1));
    for (const file of [paths.root, paths.manifestPath, paths.transactionPath, paths.attemptRoot]) assertPlainPath(file);
    if (opts.prepareRecovery) {
      if (fs.existsSync(paths.root)) throw policyError('a recovery attempt already exists');
      if (!opts.availability) throw argError('prepare-recovery requires current --availability');
      const requestPath = path.resolve(opts.prepareRecovery);
      assertPlainPath(requestPath);
      if (inside(requestPath, runDir) || inside(requestPath, planEntry.cwd)) throw policyError('prepared recovery request must be outside the sealed run and product');
      const original = interruptedSnapshot(sealed, planEntry, dependencies);
      const previousAttempt = Number(opts.recoveryAttempt) === 2 ? failedRecoverySnapshot(sealed, planEntry) : null;
      // Reject stray/conflicting physical attempts before creating a request.
      resolveRecovery(sealed, planEntry, JSON.parse(fs.readFileSync(original.originalFile, 'utf8')));
      const launch = JSON.parse(fs.readFileSync(path.join(original.evidenceDir, 'launch.json'), 'utf8'));
      const stopped = (dependencies.assertInterruptedChildStopped || assertInterruptedChildStopped)(original.pid, launch, original.evidenceDir);
      const manifest = { schemaVersion: 1, protocol: RECOVERY_PROTOCOL, planId: sealed.plan.planId, planHash: seal.planHash, entry: planEntry,
        attemptRoot: paths.attemptRoot, transactionPath: paths.transactionPath, preparedAt: new Date().toISOString(), original,
        availability: { path: fs.realpathSync(opts.availability), sha256: hashFile(opts.availability) }, stopped };
      if (previousAttempt) Object.assign(manifest, { schemaVersion: 2, attempt: 2, previousAttempt,
        previousStopped: (dependencies.assertInterruptedChildStopped || assertInterruptedChildStopped)(previousAttempt.pid,
          JSON.parse(fs.readFileSync(path.join(previousAttempt.evidenceDir, 'launch.json'), 'utf8')), previousAttempt.evidenceDir) });
      verifyRecoveryManifest(sealed, planEntry, manifest, { nowMs: Date.now(), dependencies });
      fs.writeFileSync(requestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      return { ok: false, status: 'RECOVERY_PREPARED', requestPath, recoverySha256: hashFile(requestPath), nativeCalls: 0 };
    }
    if (!/^[a-f0-9]{64}$/.test(opts.recoverySha256 || '')) throw argError('recover-interrupted requires the inspected --recovery-sha256');
    assertPlainPath(opts.recoverInterrupted);
    if (hashFile(opts.recoverInterrupted) !== opts.recoverySha256) throw policyError('recovery request differs from its inspected hash');
    const manifest = JSON.parse(fs.readFileSync(opts.recoverInterrupted, 'utf8'));
    paths = recoveryPaths(runDir, planEntry, manifest.schemaVersion === 2 ? manifest.attempt : 1);
    if (fs.existsSync(paths.root)) {
      const original = JSON.parse(fs.readFileSync(path.join(runDir, '.magi-dispatches', `${transactionKey(planEntry)}.json`), 'utf8'));
      const saved = resolveRecovery(sealed, planEntry, original);
      if (!saved || saved.manifestPath !== paths.manifestPath || hashFile(paths.manifestPath) !== opts.recoverySha256 || saved.state.status !== 'PASS') throw policyError('recovery already exists and has no committed PASS; do not relaunch');
      verifyExecution(sealed, planEntry, saved.state);
      return { ok: true, replayed: true, proofId: saved.state.telemetry.proofId, receipt: saved.state.receipt, telemetry: saved.state.telemetry };
    }
    verifyRecoveryManifest(sealed, planEntry, manifest, { nowMs: Date.now(), dependencies });
    resolveRecovery(sealed, planEntry, JSON.parse(fs.readFileSync(manifest.original.originalFile, 'utf8')));
    const oldLaunch = JSON.parse(fs.readFileSync(path.join(manifest.original.evidenceDir, 'launch.json'), 'utf8'));
    (dependencies.assertInterruptedChildStopped || assertInterruptedChildStopped)(manifest.original.pid, oldLaunch, manifest.original.evidenceDir);
    if (manifest.previousAttempt) (dependencies.assertInterruptedChildStopped || assertInterruptedChildStopped)(manifest.previousAttempt.pid,
      JSON.parse(fs.readFileSync(path.join(manifest.previousAttempt.evidenceDir, 'launch.json'), 'utf8')), manifest.previousAttempt.evidenceDir);
    recovery = { ...paths, manifest, sha256: opts.recoverySha256, requestPath: path.resolve(opts.recoverInterrupted) };
  }
  opts = { ...planEntry, planHash: seal.planHash, evidenceDir: path.join(runDir, 'out', opts.dispatchId), ...opts };
  if (recovery) opts.evidenceDir = path.join(recovery.attemptRoot, 'out', opts.dispatchId);
  required(opts);
  const originalBrief = path.resolve(opts.brief);
  const evidenceDir = path.resolve(opts.evidenceDir);
  const cwd = fs.realpathSync(opts.cwd);
  const policyEnv = dependencies.env || process.env;
  allowedWorkspace(cwd, policyEnv);
  if (!inside(evidenceDir, runDir)) throw policyError('evidence directory must be inside its sealed run directory');
  if (inside(evidenceDir, cwd)) throw policyError('evidence directory must be outside the product worktree');
  // Overrides may relocate an identical contract; they cannot weaken runtime policy.
  for (const [supplied, canonical] of [[opts.matrix, DEFAULT_MATRIX], [opts.seatProfiles, DEFAULT_PROFILES]]) {
    if (supplied && hashFile(supplied) !== hashFile(canonical)) throw policyError('runtime policy override differs from installed contract');
  }
  if (!recovery && opts.availability && hashFile(opts.availability) !== seal.availabilitySha256) {
    throw policyError('availability override differs from sealed evidence');
  }
  const matrix = sealed.matrix;
  const availability = loadAvailability(sealed.availablePath);
  const transactionPath = path.join(runDir, '.magi-dispatches', `${transactionKey(planEntry)}.json`);
  assertPlainPath(transactionPath);
  const savedState = !recovery && fs.existsSync(transactionPath) ? JSON.parse(fs.readFileSync(transactionPath, 'utf8')) : null;
  const postRun = planEntry.vendor === 'anthropic';
  let legacyReplay = false;
  if (postRun && opts.onTopic === true && opts.captureSha256 === undefined && savedState?.status === 'PASS' &&
      savedState.attestationProtocol === undefined && seal.attestationProtocol === undefined) {
    // The producing command attested historical PASS runs without a checkpoint hash.
    // Validate their native evidence before accepting that command contract again.
    verifyExecution(sealed, planEntry, savedState);
    legacyReplay = true;
  }
  const attesting = postRun && !legacyReplay && (opts.onTopic === true || opts.captureSha256 !== undefined);
  if (opts.captureSha256 !== undefined && !postRun) throw argError('--capture-sha256 is only for Claude post-run attestation');
  if (attesting) {
    if (opts.onTopic !== true || typeof opts.captureSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(opts.captureSha256)) throw argError('post-run attestation requires --on-topic and --capture-sha256 with a lowercase SHA-256');
    if (!savedState || ![AWAITING_ATTESTATION, 'PASS'].includes(savedState.status) || savedState.attestationProtocol !== ATTESTATION_PROTOCOL) throw policyError('post-run attestation requires an existing Claude checkpoint; premature attestation cannot launch a child');
    if (savedState.receipt?.captureSha256 !== opts.captureSha256) throw policyError('attestation capture hash does not match the checkpoint');
  }
  // Completed evidence keeps its proven launch-time availability. These paths never launch.
  const resuming = savedState?.status === 'PASS' || (postRun && savedState?.attestationProtocol === ATTESTATION_PROTOCOL && savedState.status === AWAITING_ATTESTATION);
  if (savedState?.status === 'PASS') verifyExecution(sealed, planEntry, savedState);
  const resumeAt = resuming ? Date.parse(savedState.startedAt) : undefined;
  if (resuming && !Number.isFinite(resumeAt)) throw policyError('completed dispatch is missing its launch time');
  // The unchanged whole plan remains validated at its seal time. Only the new
  // physical attempt needs a fresh exact-route probe, checked separately above.
  const binding = bindDispatch(opts, matrix, availability, recovery ? Date.parse(seal.sealedAt) : resumeAt);
  if (inside(binding.planPath, cwd)) throw policyError('dispatch plan must be outside the product worktree');
  opts = { ...opts, ...binding.entry, cwd, planHash: binding.planHash, planId: binding.plan.planId };
  const telemetryLog = path.resolve(opts.telemetryLog || path.join(runDir, 'telemetry', 'dispatches.jsonl'));
  const activationLog = path.resolve(opts.activationLog || path.join(runDir, 'magi-dispatch-log.jsonl'));
  if ([telemetryLog, activationLog].some((file) => !inside(file, runDir) || inside(file, cwd))) throw policyError('dispatch logs must be inside the run directory and outside the product worktree');
  for (const file of [telemetryLog, activationLog, evidenceDir]) assertPlainPath(file);
  if (!savedState) {
    if (opts.vendor === 'openai' && opts.role !== 'implement' &&
        path.win32.resolve(evidenceDir).toLowerCase() !== path.win32.resolve(recovery?.attemptRoot || runDir, 'out', opts.dispatchId).toLowerCase()) {
      throw policyError('OpenAI checking roles require the standard run/out/dispatch-id evidence directory for scoped scratch');
    }
    if (seal.schemaVersion !== 2 || !seal.skillSource) throw policyError('unbound historical seal cannot launch new work; seal a new run');
    if (seal.matrixSha256 !== hashFile(DEFAULT_MATRIX) || seal.profilesSha256 !== hashFile(DEFAULT_PROFILES)) throw policyError('installed runtime policy differs from sealed policy');
    opts.skillSourceRoot = opts.skillSourceRoot || seal.skillSource.sourceRoot;
    verifySkillSource(seal.skillSource, opts.skillSourceRoot);
    // Use the same configured sources as staging before reserving or writing evidence.
    try { opts.rulesRoot = resolveRulesRoot({ rulesRoot: opts.rulesRoot, defaultRulesRoot: DEFAULT_RULES_ROOT }); }
    catch (error) { error.code = 'RULES_SOURCE_MISSING'; throw error; }
  }
  validateLogDestinations(sealed, [telemetryLog, activationLog], evidenceDir, [DEFAULT_MATRIX, DEFAULT_PROFILES, ...[opts.rulesRoot, opts.skillSourceRoot].filter(Boolean)]);
  if (!savedState) {
    if (fs.existsSync(evidenceDir) && (!fs.lstatSync(evidenceDir).isDirectory() || fs.readdirSync(evidenceDir).length)) throw policyError('evidence directory must be new or empty');
    const profile = buildSeatProfile(loadProfiles(), { vendor: opts.vendor, role: opts.role, class: opts.class, arbiter: false, subdispatch: false });
    prepareSeatSkills({ skills: profile.skills, sourceRoot: opts.skillSourceRoot, sourceBinding: seal.skillSource, destinationRoot: path.join(evidenceDir, 'skills') });
    const rules = prepareRulesSource({ rulesRoot: opts.rulesRoot });
    if (rules.fingerprint !== FINGERPRINT_V2) throw policyError('production dispatch requires the external STANDING v2 / R01-R22 pack');
    const stagedRules = path.join(evidenceDir, 'brief', 'RULES');
    if (inside(stagedRules, rules.root) || inside(rules.root, stagedRules)) throw policyError('rules source and staging directory must not overlap');
  }
  const prerequisites = savedState ? null : verifyPrerequisites(sealed, binding.entry,
    ['review', 'verify'].includes(opts.role) ? snapshotWorkspace(cwd) : undefined, new Date().toISOString());
  const evidenceReadDirs = validateEvidenceReadDirs(binding.entry, { plan: sealed.plan, runDir,
    requireExisting: !savedState, forbiddenRoots: [opts.rulesRoot, seal.skillSource?.sourceRoot].filter(Boolean) });
  if (!savedState) snapshotEvidenceReads(evidenceReadDirs);
  opts = { ...opts, evidenceReadDirs };
  let transaction;
  if (recovery) {
    // Exclusive directory creation is the one-attempt reservation. A crash here
    // leaves inspectable incomplete lineage and never permits an automatic retry.
    fs.mkdirSync(path.dirname(recovery.root), { recursive: true });
    fs.mkdirSync(recovery.root);
    fs.copyFileSync(recovery.requestPath, recovery.manifestPath, fs.constants.COPYFILE_EXCL);
    if (hashFile(recovery.manifestPath) !== recovery.sha256) throw policyError('recovery request changed during reservation');
    const startedAt = new Date().toISOString();
    verifyRecoveryManifest(sealed, binding.entry, recovery.manifest, { nowMs: Date.parse(startedAt), dependencies });
    transaction = { file: recovery.transactionPath, state: { schemaVersion: 1, status: 'RUNNING', requestHash: hashText(JSON.stringify({ planHash: binding.planHash, entry: binding.entry })),
      planHash: binding.planHash, planId: binding.plan.planId, entry: binding.entry, evidenceDir, startedAt, recoverySha256: recovery.sha256 }, replayed: false };
    fs.writeFileSync(transaction.file, `${JSON.stringify(transaction.state)}\n`, { encoding: 'utf8', flag: 'wx' });
  } else transaction = reserveTransaction(binding, evidenceDir, postRun ? ATTESTATION_PROTOCOL : undefined);
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
    sourceBinding: seal.skillSource,
    destinationRoot: path.join(evidenceDir, 'skills'),
  });
  writeJson(path.join(evidenceDir, 'seat-profile.json'), seatProfile);
  const staged = stageRules({ briefPath: brief, rulesRoot: opts.rulesRoot });
  if (staged.manifest.fingerprint !== FINGERPRINT_V2) throw policyError('production dispatch requires the external STANDING v2 / R01-R22 pack');
  verifyStagedRules(brief);
  const seatContractPath = path.join(evidenceDir, 'SEAT-CONTRACT.md');
  fs.writeFileSync(seatContractPath, seatContractText(opts, seatProfile, skillStage, staged), 'utf8');
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

  const evidenceReadsBefore = snapshotEvidenceReads(evidenceReadDirs);
  const launch = (dependencies.buildLaunch || buildLaunch)({
    vendor: opts.vendor, role: opts.role, briefPath: brief, cwd: opts.cwd, model: opts.model,
    effort: opts.vendor === 'google' ? undefined : opts.effort,
    capturePath, skillRoot: skillStage.root, seatContractPath,
    runDir: recovery?.attemptRoot || runDir, dispatchId: opts.dispatchId, readonlyScratch: opts.vendor === 'openai' && opts.role !== 'implement',
    reviewPermissionMode: opts.reviewPermissionMode,
    responseProtocol,
    env: policyEnv,
    ...(evidenceReadDirs.length ? { evidenceReadDirs } : {}),
  });
  if (responseProtocol) validateClaudeResponseLaunch(launch);
  validateEvidenceReadLaunch(launch, binding.entry, evidenceReadDirs, { cwd, briefPath: brief, skillRoot: skillStage.root, seatContractPath });
  if (launch.nativeLogPath) {
    if (!inside(launch.nativeLogPath, evidenceDir)) throw new Error('native log must stay inside dispatch evidence');
    assertPlainPath(launch.nativeLogPath);
    fs.rmSync(launch.nativeLogPath, { force: true });
  }
  if (launch.synaraCaptureEventsPath) {
    const eventsPath = path.join(evidenceDir, GOOGLE_CAPTURE_EVENTS);
    const captureKeys = Object.keys(launch.env || {}).filter(key => ['SYNARA_ANTIGRAVITY_EVENTS', 'SYNARA_ANTIGRAVITY_HOOK_DECISION'].includes(key.toUpperCase()));
    if (launch.vendor !== 'google' || launch.synaraCaptureEventsPath !== eventsPath ||
        launch.synaraCaptureEventsTrust !== SYNARA_CAPTURE_TRUST || captureKeys.length !== 2 ||
        launch.env.SYNARA_ANTIGRAVITY_EVENTS !== eventsPath || launch.env.SYNARA_ANTIGRAVITY_HOOK_DECISION !== 'allow') {
      throw new Error('Google capture must use its exact dispatch-local diagnostic path and child environment');
    }
    assertPlainPath(eventsPath);
    fs.rmSync(eventsPath, { force: true });
  }
  const runtimeFiles = runtimeManifest();
  const runtimeSha256 = hashText(JSON.stringify(runtimeFiles));
  atomicJson(path.join(evidenceDir, 'runtime-manifest.json'), runtimeFiles);
  const launchPath = path.join(evidenceDir, 'launch.json');
  const catalogPath = path.join(runDir, 'synara-catalog.json');
  const synaraOverlay = fs.existsSync(catalogPath)
    ? launchOverlay(loadCatalog(catalogPath), opts.vendor, opts.model, opts.effort)
    : {};
  writeJson(launchPath, {
    class: opts.class, vendor: launch.vendor, role: launch.role, model: opts.model, effort: opts.effort,
    planId: opts.planId, planHash: opts.planHash, planEntry: binding.entry, escalation: opts.escalation === true, escalationReason: opts.escalationReason || null,
    binary: launch.binary, args: launch.args, cwd: launch.cwd, nativeLogPath: launch.nativeLogPath,
    ...(responseProtocol ? { stdio: launch.stdio, stdinFile: launch.stdinFile } : {}),
    ...(launch.synaraCaptureEventsPath ? { synaraCaptureEventsPath: launch.synaraCaptureEventsPath, synaraCaptureEventsTrust: SYNARA_CAPTURE_TRUST } : {}),
    responseProtocol,
    instructionReadProtocol: INSTRUCTION_READ_PROTOCOL,
    ...(launch.scratchPermissions ? { scratchPermissions: launch.scratchPermissions, scratchEnv: launch.scratchEnv } : {}),
    ...(Object.keys(synaraOverlay).length ? synaraOverlay : {}),
    ...(evidenceReadDirs.length ? { evidenceReadDirs, evidenceReadsSha256: hashText(JSON.stringify(evidenceReadsBefore)) } : {}),
    ...(postRun ? { attestationProtocol: ATTESTATION_PROTOCOL, logDestinations: { telemetryLog, activationLog } } : {}),
    sequenceProtocol: SEQUENCE_PROTOCOL, startedAt: transaction.state.startedAt, prerequisites,
    ...(recovery ? { recoverySha256: recovery.sha256 } : {}),
    matrixVersion: matrix.schemaVersion, seatProfileVersion: seatProfiles.schemaVersion,
    seatContractPath, skillManifestPath: skillStage.manifestPath, runtimeSha256,
  });

  const protectedPaths = [binding.planPath, sealed.sealPath, sealed.availablePath, originalBrief, DEFAULT_MATRIX, DEFAULT_PROFILES, brief, seatContractPath, staged.manifestPath, skillStage.manifestPath, path.join(evidenceDir, 'seat-profile.json'), launchPath,
    ...(recovery ? [recovery.manifestPath, recovery.manifest.availability.path] : []),
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
  if (JSON.stringify(evidenceReadsBefore) !== JSON.stringify(snapshotEvidenceReads(evidenceReadDirs))) throw policyError('read-only evidence inputs changed before launch');
  if (evidenceReadDirs.length) atomicJson(path.join(evidenceDir, 'evidence-reads-before.json'), evidenceReadsBefore);
  if (recovery) {
    if (hashFile(recovery.manifestPath) !== recovery.sha256 || hashFile(recovery.requestPath) !== recovery.sha256) throw policyError('recovery manifest changed before launch');
    verifyRecoveryManifest(sealed, binding.entry, recovery.manifest, { nowMs: Date.now(), dependencies });
    (dependencies.assertInterruptedChildStopped || assertInterruptedChildStopped)(recovery.manifest.original.pid,
      JSON.parse(fs.readFileSync(path.join(recovery.manifest.original.evidenceDir, 'launch.json'), 'utf8')), recovery.manifest.original.evidenceDir);
    if (recovery.manifest.previousAttempt) (dependencies.assertInterruptedChildStopped || assertInterruptedChildStopped)(recovery.manifest.previousAttempt.pid,
      JSON.parse(fs.readFileSync(path.join(recovery.manifest.previousAttempt.evidenceDir, 'launch.json'), 'utf8')), recovery.manifest.previousAttempt.evidenceDir);
  }
  const result = await (dependencies.runLaunch || runLaunch)(launch, { pidFile, stdoutFile: stdoutPath, stderrFile: stderrPath, maxWallMs, signal: dependencies.signal });
  for (const file of [telemetryLog, activationLog, capturePath, path.join(evidenceDir, 'vendor.log'), transaction.file, path.join(runDir, '.magi-sessions'), ...(launch.nativeLogPath ? [launch.nativeLogPath] : []), ...(launch.synaraCaptureEventsPath ? [launch.synaraCaptureEventsPath] : [])]) assertPlainPath(file);
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
  const evidenceReadsAfter = snapshotEvidenceReads(evidenceReadDirs);
  if (evidenceReadDirs.length) atomicJson(path.join(evidenceDir, 'evidence-reads-after.json'), evidenceReadsAfter);
  if (JSON.stringify(evidenceReadsBefore) !== JSON.stringify(evidenceReadsAfter)) throw policyError('read-only evidence inputs changed during dispatch');
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
  const proof = (postRun ? verifyNativeProof : verifyProof)({ vendor: opts.vendor, capture: capturePath, log: path.join(evidenceDir, 'vendor.log'), expectedModel: opts.model, expectedObservedModel: modelSpec.canonical || opts.model, expectedEffort: opts.effort, expectedSandbox: launch.requestedSandbox, launch, runDir: recovery?.attemptRoot || runDir, dispatchId: opts.dispatchId, expectedRole: opts.role, expectedCwd: cwd, onTopic: opts.onTopic, responseProtocol });
  const sessionId = proof.sessionId || proof.conversationId;
  if (recovery) {
    verifyRecoveryManifest(sealed, binding.entry, recovery.manifest, { nowMs: Date.parse(transaction.state.startedAt), dependencies });
    if ([recovery.manifest.original.native.sessionId, recovery.manifest.previousAttempt?.native.sessionId].includes(sessionId)) throw policyError('replacement reused an earlier native session');
  }
  const captureText = fs.readFileSync(capturePath, 'utf8');
  const transcript = opts.vendor === 'anthropic' ? { path: capturePath, text: captureText } :
    (opts.vendor === 'openai' ? (dependencies.codexSessionTranscript || codexSessionTranscript) : (dependencies.googleSessionTranscript || googleSessionTranscript))
      (sessionId, { cwd, briefPath: brief, seatContractPath });
  if (!transcript || typeof transcript.text !== 'string' || !path.isAbsolute(transcript.path || '')) throw Object.assign(new Error('native instruction transcript collector returned invalid evidence'), { code: 'INSTRUCTION_READ_FAIL' });
  const transcriptBinding = { protocol: INSTRUCTION_READ_PROTOCOL, vendor: opts.vendor, sessionId, sourcePath: transcript.path, sha256: hashText(transcript.text) };
  for (const name of ['native-instructions.jsonl', 'instruction-transcript.json', 'instruction-reads.json']) {
    const file = path.join(evidenceDir, name); assertPlainPath(file);
    if (fs.existsSync(file)) throw policyError('native child wrote runner-owned instruction evidence: ' + name);
  }
  fs.writeFileSync(path.join(evidenceDir, 'native-instructions.jsonl'), transcript.text, 'utf8');
  writeJson(path.join(evidenceDir, 'instruction-transcript.json'), transcriptBinding);
  let instructionReads;
  try {
    instructionReads = verifyInstructionReadEvidence({ vendor: opts.vendor, sessionId, captureText, expectedCwd: cwd,
      transcriptText: transcript.text, googleTranscriptBinding: { conversationId: sessionId, sha256: transcriptBinding.sha256 },
      briefPath: brief, seatContractPath, skillRoot: skillStage.root, seatProfile,
      rulesManifest: staged.manifest, skillsManifest: skillStage.manifest });
  } catch (error) {
    writeJson(path.join(evidenceDir, 'instruction-reads.json'), { protocol: INSTRUCTION_READ_PROTOCOL, status: 'FAIL', code: error.code || 'INSTRUCTION_READ_FAIL', error: error.message });
    throw error;
  }
  writeJson(path.join(evidenceDir, 'instruction-reads.json'), instructionReads);
  proof.instructionReads = { protocol: INSTRUCTION_READ_PROTOCOL, requiredSetSha256: instructionReads.requiredSetSha256, evidenceSha256: instructionReads.evidenceSha256 };
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
    class: opts.class, vendor: opts.vendor, role: opts.role, hostMode: sealed.plan.hostMode, routedBy: 'arbiter', capturedBy: 'lead',
    model: opts.model, modelRequested: opts.model, modelObserved: proof.modelObserved, effort: opts.effort, proofId, vendorSideTokens: proof.vendorSideTokens ?? null,
    ...(opts.vendor === 'google' ? { totalTokens: proof.usage.total_tokens } : {}),
    authorVendor: opts.authorVendor || null, planId: opts.planId, planHash: opts.planHash, escalation: opts.escalation === true, escalationReason: opts.escalationReason || null,
    transactionPath: transaction.file,
    note: `evidence=${evidenceDir};matrix=v${matrix.schemaVersion};seat-profile=v${seatProfiles.schemaVersion}`,
  }, { requireCursorCli: true, requireArbiter: true, requireDispatchId: true, requireUnitId: true, requireProof: true });

  const receipt = {
    schemaVersion: 2, status: 'PASS', dispatchId: opts.dispatchId, unitId: opts.unitId, class: opts.class, vendor: opts.vendor, role: opts.role,
    model: opts.model, effort: opts.effort, proofId, matrixVersion: matrix.schemaVersion, seatProfileVersion: seatProfiles.schemaVersion,
    seatSkills: seatProfile.skills, permissionProfile: seatProfile.permissionProfile,
    instructionReadProtocol: INSTRUCTION_READ_PROTOCOL,
    instructionReadEvidenceSha256: hashFile(path.join(evidenceDir, 'instruction-reads.json')),
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
  artifacts.push(...['native-instructions.jsonl', 'instruction-transcript.json', 'instruction-reads.json'].map(name => ({ path: path.join(evidenceDir, name), sha256: hashFile(path.join(evidenceDir, name)) })));
  if (evidenceReadDirs.length) artifacts.push(...['evidence-reads-before.json', 'evidence-reads-after.json'].map(name => ({ path: path.join(evidenceDir, name), sha256: hashFile(path.join(evidenceDir, name)) })));
  artifacts.push(...protectedHashes.filter(file => !artifacts.some(item => item.path === file.path)));
  if (launch.nativeLogPath && fs.existsSync(launch.nativeLogPath)) artifacts.push({ path: launch.nativeLogPath, sha256: hashFile(launch.nativeLogPath) });
  if (launch.synaraCaptureEventsPath && fs.existsSync(launch.synaraCaptureEventsPath)) artifacts.push({
    path: launch.synaraCaptureEventsPath, sha256: hashFile(launch.synaraCaptureEventsPath), trust: SYNARA_CAPTURE_TRUST,
  });
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
    if (error.code === 'CHILD_EXIT_UNCONFIRMED' || error.exitConfirmed === false) {
      scopeAudit = { ok: false, incomplete: true, exitConfirmed: false, childPid: error.pid,
        error: 'Child exit is unconfirmed; the child may still be running and no final workspace audit is available.' };
    }
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

async function main(argv = process.argv.slice(2), io = process, dependencies = {}) {
  const host = dependencies.process || process;
  const controller = dependencies.abortController || new AbortController();
  const stop = () => controller.abort();
  host.once('SIGINT', stop);
  host.once('SIGTERM', stop);
  try {
    const opts = parseArgs(argv);
    if (opts.help) { io.stdout.write(`${usage()}\n`); return 0; }
    const result = await runDispatch(opts, { ...dependencies, signal: dependencies.signal || controller.signal });
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const code = error.code || 'DISPATCH_FAIL';
    io.stderr.write(`${code}: ${error.message}\n`);
    return ['ARGUMENT_ERROR', 'BINARY_MISSING', 'RULES_SOURCE_MISSING', 'SKILL_STAGE_FAIL'].includes(code) ? 2 : 1;
  } finally {
    host.removeListener('SIGINT', stop);
    host.removeListener('SIGTERM', stop);
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });
module.exports = { appendJsonl, main, parseArgs, runDispatch, seatContractText };
