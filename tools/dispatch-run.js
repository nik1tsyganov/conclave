#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildLaunch } = require('./cli-adapters.js');
const { runLaunch } = require('./cli-runner.js');
const { stageRules, verifyStagedRules } = require('./cli-rules-stage.js');
const { checkBriefFile } = require('./cli-brief-rules-check.js');
const { verifyProof } = require('./cli-proof.js');
const { validateDispatchRow } = require('./dispatch-schema.js');
const { loadMatrix, loadAvailability, routeAllowed } = require('./dispatch-matrix.js');
const { loadProfiles, buildSeatProfile } = require('./seat-policy.js');
const { stageSeatSkills } = require('./cli-skill-stage.js');

function argError(message) { const e = new Error(message); e.code = 'ARGUMENT_ERROR'; return e; }
function policyError(message) { const e = new Error(message); e.code = 'POLICY_FAIL'; return e; }
function hashText(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function appendJsonl(file, row) { fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true }); fs.appendFileSync(path.resolve(file), `${JSON.stringify(row)}\n`, 'utf8'); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }

function parseArgs(argv) {
  const out = { onTopic: false };
  const values = new Set([
    '--vendor', '--role', '--class', '--brief', '--cwd', '--model', '--effort', '--dispatch-id', '--unit-id',
    '--evidence-dir', '--telemetry-log', '--activation-log', '--rules-root', '--review-permission-mode',
    '--matrix', '--availability', '--author-vendor', '--seat-profiles', '--skill-source-root',
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
    'Usage: node tools/dispatch-run.js --vendor <openai|google|anthropic> --role <implement|review|verify>',
    '  --class <routing-class> --brief <BRIEF.md> --cwd <worktree> --model <slug> --effort <level>',
    '  --dispatch-id <id> --unit-id <id> --evidence-dir <dir> [--availability <json>]',
    '  [--author-vendor <vendor>] [--rules-root <dir>] [--seat-profiles <json>] [--skill-source-root <dir>] [--on-topic]',
    '',
    'Runs one fail-closed MAGI CLI seat transaction. Matrix, seat policy, staged skills, rules, proof, and telemetry are enforced in code.',
  ].join('\n');
}

function required(opts) {
  for (const key of ['vendor', 'role', 'class', 'brief', 'cwd', 'model', 'effort', 'dispatchId', 'unitId', 'evidenceDir']) {
    if (!opts[key]) throw argError(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
  }
  if (!['openai', 'google', 'anthropic'].includes(opts.vendor)) throw argError('invalid --vendor');
  if (!['implement', 'review', 'verify'].includes(opts.role)) throw argError('invalid --role');
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
    `Permission profile: ${seatProfile.permissionProfile}`,
    '',
    'This is a leaf seat. Do not dispatch, delegate, spawn, or ask another model/agent to perform work.',
    'This seat is not the arbiter. Do not change routing, model choice, panel membership, or deterministic gate outcomes.',
    opts.role === 'implement' ? 'Writes are limited to BRIEF.md scope in the assigned worktree.' : 'Read-only judgment role: do not modify product files.',
    '',
    'Allowed staged skills:',
    ...seatProfile.skills.map((skill) => `- ${skill}: ${path.join(skillStage.root, skill, 'SKILL.md')}`),
    '',
    `Skill manifest: ${skillStage.manifestPath}`,
    `Required proof fields: ${seatProfile.proofFields.join(', ')}`,
    '',
  ].join('\n');
}

async function runDispatch(opts) {
  required(opts);
  const brief = path.resolve(opts.brief);
  const evidenceDir = path.resolve(opts.evidenceDir);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const matrix = loadMatrix(opts.matrix);
  const availability = loadAvailability(opts.availability);
  const routePolicy = routeAllowed(matrix, { class: opts.class, role: opts.role, vendor: opts.vendor, model: opts.model, effort: opts.effort }, availability);
  if (!routePolicy.ok) throw policyError(routePolicy.reason);

  const seatProfiles = loadProfiles(opts.seatProfiles);
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
  verifyStagedRules(brief);
  const briefCheck = checkBriefFile(brief, { role: opts.role, vendor: opts.vendor, requireStructural: true });
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

  const launch = buildLaunch({
    vendor: opts.vendor, role: opts.role, briefPath: brief, cwd: opts.cwd, model: opts.model,
    effort: opts.vendor === 'google' ? undefined : opts.effort,
    capturePath, rulesRoot: staged.rulesRoot, skillRoot: skillStage.root, seatContractPath,
    reviewPermissionMode: opts.reviewPermissionMode,
  });
  writeJson(path.join(evidenceDir, 'launch.json'), {
    class: opts.class, vendor: launch.vendor, role: launch.role, model: opts.model, effort: opts.effort,
    binary: launch.binary, args: launch.args, cwd: launch.cwd,
    matrixVersion: matrix.schemaVersion, seatProfileVersion: seatProfiles.schemaVersion,
    seatContractPath, skillManifestPath: skillStage.manifestPath,
  });

  const result = await runLaunch(launch, { pidFile, stdoutFile: stdoutPath, stderrFile: stderrPath });
  if (!result.ok) {
    const error = new Error(`vendor child failed exit=${result.exitCode}${result.killReason ? ` reason=${result.killReason}` : ''}`);
    error.code = 'LAUNCH_FAIL';
    throw error;
  }

  if (opts.vendor !== 'openai') fs.writeFileSync(capturePath, result.stdout, 'utf8');
  else if (!fs.existsSync(capturePath)) fs.writeFileSync(capturePath, result.stdout, 'utf8');
  const combinedLog = `${result.stderr}\n${result.stdout}`;
  fs.writeFileSync(path.join(evidenceDir, 'vendor.log'), combinedLog, 'utf8');

  const proof = verifyProof({ vendor: opts.vendor, capture: capturePath, log: path.join(evidenceDir, 'vendor.log'), expectedModel: opts.model, expectedEffort: opts.effort, onTopic: opts.onTopic });
  for (const field of seatProfile.proofFields) {
    if (proof[field] === undefined || proof[field] === null) {
      const error = new Error(`seat proof missing required field: ${field}`);
      error.code = 'PROOF_FAIL';
      throw error;
    }
  }
  const proofId = hashText(JSON.stringify(proof));
  writeJson(path.join(evidenceDir, 'proof.json'), { proofId, class: opts.class, ...proof });

  const now = new Date();
  const telemetry = validateDispatchRow({
    schemaVersion: 1, date: now.toISOString().slice(0, 10), dispatchId: opts.dispatchId, unitId: opts.unitId,
    class: opts.class, vendor: opts.vendor, role: opts.role, hostMode: 'cursor-cli', routedBy: 'arbiter', capturedBy: 'lead',
    model: opts.model, effort: opts.effort, proofId, vendorSideTokens: proof.vendorSideTokens ?? null,
    note: `evidence=${evidenceDir};matrix=v${matrix.schemaVersion};seat-profile=v${seatProfiles.schemaVersion}`,
  }, { requireCursorCli: true, requireArbiter: true, requireDispatchId: true, requireUnitId: true, requireProof: true });

  const telemetryLog = opts.telemetryLog || path.resolve(__dirname, '..', 'telemetry', 'dispatches.jsonl');
  appendJsonl(telemetryLog, telemetry);
  if (opts.role === 'implement') appendJsonl(opts.activationLog || path.resolve(__dirname, '..', 'magi-dispatch-log.jsonl'), telemetry);

  const receipt = {
    schemaVersion: 1, dispatchId: opts.dispatchId, unitId: opts.unitId, class: opts.class, vendor: opts.vendor, role: opts.role,
    model: opts.model, effort: opts.effort, proofId, matrixVersion: matrix.schemaVersion, seatProfileVersion: seatProfiles.schemaVersion,
    seatSkills: seatProfile.skills, permissionProfile: seatProfile.permissionProfile,
    briefSha256: crypto.createHash('sha256').update(fs.readFileSync(brief)).digest('hex'),
    captureSha256: crypto.createHash('sha256').update(fs.readFileSync(capturePath)).digest('hex'),
    seatContractSha256: crypto.createHash('sha256').update(fs.readFileSync(seatContractPath)).digest('hex'),
    skillsManifestSha256: crypto.createHash('sha256').update(fs.readFileSync(skillStage.manifestPath)).digest('hex'),
    rulesManifest: staged.manifestPath, completedAt: now.toISOString(),
  };
  writeJson(path.join(evidenceDir, 'receipt-ack.json'), receipt);
  writeJson(path.join(evidenceDir, 'handoff-envelope.json'), { ...receipt, telemetryLog, status: 'PASS' });
  return { ok: true, proofId, receipt, telemetry };
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
