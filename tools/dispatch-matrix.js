#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { CLI_HOST_MODES, isCliHostMode, ROLES } = require('./dispatch-schema.js');
const { verifyProbe } = require('./probe-evidence.js');
const { parseJsonBytes, readJsonFile } = require('./json-file.js');
const { validateEvidenceReadDirs } = require('./evidence-read-access.js');

const DEFAULT_MATRIX = require('./runtime-paths.js').resolveRuntimePaths().matrixPath;
const DEFAULT_PROBE_MAX_AGE_MINUTES = 60;

function argumentError(message) { const e = new Error(message); e.code = 'ARGUMENT_ERROR'; return e; }
function policyError(message) { const e = new Error(message); e.code = 'POLICY_FAIL'; return e; }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value); }

function loadMatrix(file = DEFAULT_MATRIX) {
  return readJsonFile(path.resolve(file));
}

function loadAvailability(file) {
  if (!file) return {};
  try { return readJsonFile(path.resolve(file)); }
  catch (error) { throw argumentError(`cannot read availability file: ${error.message}`); }
}

function probeIsFresh(matrix, observed, nowMs = Date.now()) {
  const maxMinutes = matrix.principles?.probeMaxAgeMinutes ?? DEFAULT_PROBE_MAX_AGE_MINUTES;
  const observedMs = Date.parse(observed?.observedAt || '');
  if (!Number.isFinite(observedMs)) return false;
  const ageMs = nowMs - observedMs;
  return ageMs >= -5 * 60_000 && ageMs <= maxMinutes * 60_000;
}

function routeAllowed(matrix, route, availability = {}, nowMs = Date.now()) {
  const cls = matrix.classes?.[route.class];
  if (!cls) return { ok: false, reason: `unknown class ${route.class}` };
  const list = cls[route.role];
  if (!Array.isArray(list)) return { ok: false, reason: `class ${route.class} has no ${route.role} lane` };
  const matched = list.find((entry) => entry.vendor === route.vendor && entry.model === route.model && entry.effort === route.effort);
  if (!matched) return { ok: false, reason: `route not in matrix: ${route.class}/${route.role} ${route.vendor}/${route.model}/${route.effort}` };
  const modelSpec = matrix.vendors?.[route.vendor]?.models?.[route.model];
  if (!modelSpec) return { ok: false, reason: `model absent from vendor catalog: ${route.vendor}/${route.model}` };
  if (!modelSpec.efforts.includes(route.effort)) return { ok: false, reason: `effort ${route.effort} unsupported by ${route.model}` };
  if (matched.escalationOnly || modelSpec.tier === 'frontier-plus') {
    if (route.escalation !== true) return { ok: false, reason: `escalation-only route requires escalation=true: ${route.vendor}/${route.model}` };
    if (typeof route.escalationReason !== 'string' || route.escalationReason.trim().length < 16 || new Set(route.escalationReason.trim().toLowerCase().split(/\s+/)).size < 3) {
      return { ok: false, reason: `escalation-only route requires escalationReason: ${route.vendor}/${route.model}` };
    }
  }
  if ((matrix.principles.requireObservedModelProof || matched.requiresProbe || modelSpec.availability === 'probe-required')) {
    const modelAvailability = availability?.vendors?.[route.vendor]?.models?.[route.model];
    const observed = modelAvailability?.efforts?.[route.effort] || modelAvailability;
    if (!observed || observed.available !== true || observed.observedModel !== (modelSpec.canonical || route.model) || observed.requestedModel !== route.model || observed.vendor !== route.vendor || observed.effort !== route.effort || !observed.evidence) {
      return { ok: false, reason: `probe-required route unavailable: ${route.vendor}/${route.model}` };
    }
    if (!probeIsFresh(matrix, observed, nowMs)) {
      return { ok: false, reason: `probe-required route has stale/missing availability proof: ${route.vendor}/${route.model}` };
    }
    try {
      if (sha256(fs.readFileSync(observed.evidence.path)) !== observed.evidence.sha256) throw new Error('probe record hash mismatch');
      const proof = verifyProbe(observed.evidence.path, { vendor: route.vendor, model: route.model, effort: route.effort, observedModel: modelSpec.canonical || route.model, maxAgeMinutes: matrix.principles.probeMaxAgeMinutes || DEFAULT_PROBE_MAX_AGE_MINUTES, nowMs });
      if (proof.completedAt !== observed.observedAt) throw new Error('availability timestamp differs from original probe');
    } catch (error) { return { ok: false, reason: `invalid native probe evidence: ${error.message}` }; }
  }
  return { ok: true, route: matched };
}

function validatePlan(plan, matrix, availability = {}, nowMs = Date.now()) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw policyError('plan must be an object');
  if (!isCliHostMode(plan.hostMode)) throw policyError(`hostMode must be one of ${CLI_HOST_MODES.join(', ')}`);
  // The arbiter is the Jev decision engine (2026-09-16); the host session only runs tools.
  if (plan.arbiter?.vendor !== matrix.principles.arbiterVendor) throw policyError(`arbiter vendor must be ${matrix.principles.arbiterVendor}`);
  if (plan.arbiter?.model !== matrix.principles.arbiterModel) throw policyError(`arbiter model must be ${matrix.principles.arbiterModel}`);
  // Legacy sealed runs (pre-2026-09-16) carry an xai arbiter with an effort; their sealed matrix still names xai, so only a Jev matrix rejects the field.
  if (matrix.principles.arbiterVendor === 'jev' && plan.arbiter.effort !== undefined) throw policyError('arbiter effort is not a Jev field; declare the host session in arbiter.host instead');
  if (plan.arbiter.host !== undefined && (typeof plan.arbiter.host !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(plan.arbiter.host))) throw policyError('arbiter.host must be a slug');
  if (!Array.isArray(plan.dispatches) || plan.dispatches.length === 0) throw policyError('plan.dispatches must be non-empty');

  const implement = [];
  const ids = new Set();
  const authors = new Map();
  for (const route of plan.dispatches) {
    if (!route || typeof route !== 'object') throw policyError('invalid dispatch entry');
    if (route.vendor === 'xai' || route.vendor === 'jev' || route.vendor === matrix.principles.arbiterVendor) throw policyError('the arbiter may not occupy a seat');
    if (!ROLES.includes(route.role)) throw policyError(`invalid role: ${route.role}`);
    const allowed = routeAllowed(matrix, route, availability, nowMs);
    if (!allowed.ok) throw policyError(allowed.reason);
    if (route.role === 'review' || route.role === 'verify') {
      if (!['openai', 'anthropic', 'google'].includes(route.authorVendor)) throw policyError(`${route.role} requires authorVendor`);
      if (route.authorVendor === route.vendor) throw policyError(`same-vendor ${route.role} forbidden for ${route.unitId || 'unit'}`);
    }
    if (!validId(route.dispatchId) || !validId(route.unitId)) throw policyError('dispatchId and unitId must be safe non-empty identifiers');
    if (ids.has(route.dispatchId)) throw policyError(`duplicate dispatchId: ${route.dispatchId}`);
    ids.add(route.dispatchId);
    if (typeof route.cwd !== 'string' || !path.isAbsolute(route.cwd)) throw policyError(`absolute cwd required for ${route.dispatchId}`);
    if (!/^[a-f0-9]{64}$/.test(route.briefSha256 || '')) throw policyError(`briefSha256 required for ${route.dispatchId}`);
    if (!Array.isArray(route.writeScope) || (route.role === 'implement' && route.writeScope.length === 0)) throw policyError(`writeScope required for ${route.dispatchId}`);
    if (route.role !== 'implement' && route.writeScope.length) throw policyError('read-only roles must have empty writeScope');
    if (route.role === 'implement' && route.evidenceReadDirs?.length) throw policyError(`implement cannot take evidenceReadDirs: ${route.dispatchId}`);
    validateEvidenceReadDirs(route);
    for (const name of route.writeScope) {
      if (typeof name !== 'string' || !name || name.includes('\\') || name.split('/').some((part) => part === '..' || part === '.' || part === '.git' || !part) || path.isAbsolute(name) || /[:*?\x00-\x1f]/.test(name)) throw policyError(`invalid writeScope path: ${name}`);
    }
    if (route.escalation !== undefined && typeof route.escalation !== 'boolean') throw policyError('escalation must be a boolean');
    if (route.escalation === true && (typeof route.escalationReason !== 'string' || route.escalationReason.trim().length < 16)) throw policyError('escalationReason required');
    if (route.role === 'implement') {
      if (authors.has(route.unitId)) throw policyError(`duplicate implementation unit: ${route.unitId}`);
      authors.set(route.unitId, route.vendor);
      implement.push(route);
    }
  }
  if (!validId(plan.planId)) throw policyError('planId must be a safe non-empty identifier');
  const checkedUnits = new Map();
  for (const route of plan.dispatches) {
    if (['review', 'verify'].includes(route.role)) {
      const previous = checkedUnits.get(route.unitId);
      if (previous && previous.authorVendor !== route.authorVendor) throw policyError(`conflicting authorVendor for ${route.unitId}`);
      if (previous && path.resolve(previous.cwd) !== path.resolve(route.cwd)) throw policyError(`check worktrees differ for ${route.unitId}`);
      checkedUnits.set(route.unitId, route);
    }
    if (['review', 'verify'].includes(route.role) && authors.has(route.unitId) && authors.get(route.unitId) !== route.authorVendor) throw policyError(`authorVendor contradicts implementation for ${route.unitId}`);
  }
  for (const author of implement) {
    const policy = matrix.classes[author.class];
    const checks = plan.dispatches.filter((row) => row.unitId === author.unitId && ['review', 'verify'].includes(row.role));
    if (checks.some((row) => path.resolve(row.cwd) !== path.resolve(author.cwd))) throw policyError(`check worktree differs from implementation for ${author.unitId}`);
    if (policy.requiresPanel) {
      if (plan.conclaveConvened !== true) throw policyError(`class ${author.class} requires a panel`);
      const vendors = new Set(checks.map((row) => row.vendor));
      if (vendors.size < (policy.minimumReviewVendors || 2)) throw policyError(`class ${author.class} requires two independent review vendors`);
    }
  }

  if (plan.conclaveConvened === true && implement.length > 0) {
    const vendors = new Set(implement.map((r) => r.vendor));
    const minimumDistinct = Math.min(3, implement.length);
    if (vendors.size < minimumDistinct) {
      throw policyError(`CONCLAVE implementation split requires ${minimumDistinct} implement vendors for ${implement.length} units, got ${vendors.size}`);
    }
  }

  const floorMin = matrix.principles.distributionFloorMinimumImplementUnits ?? 2;
  if (implement.length >= floorMin) {
    const counts = new Map();
    for (const row of implement) counts.set(row.vendor, (counts.get(row.vendor) || 0) + 1);
    for (const [vendor, count] of counts) {
      if (count / implement.length > matrix.principles.distributionFloor) throw policyError(`distribution floor exceeded by ${vendor}`);
    }
  }

  return { ok: true, dispatches: plan.dispatches.length, implementUnits: implement.length };
}

function readValidatedPlan(file, expectedHash, matrix, availability = {}, nowMs = Date.now()) {
  if (!file) throw argumentError('--plan is required');
  const planPath = fs.realpathSync(file);
  const bytes = fs.readFileSync(planPath);
  const planHash = sha256(bytes);
  if (expectedHash !== undefined && expectedHash !== planHash) throw policyError('plan hash changed since validation');
  const plan = parseJsonBytes(bytes);
  const validation = validatePlan(plan, matrix, availability, nowMs);
  return { plan, planPath, planHash, ...validation };
}

function bindDispatch(opts, matrix, availability, nowMs) {
  if (!opts.planHash || !/^[a-f0-9]{64}$/.test(opts.planHash)) throw argumentError('--plan-hash from whole-plan validation is required');
  const validated = readValidatedPlan(opts.plan, opts.planHash, matrix, availability, nowMs);
  const entry = validated.plan.dispatches.find((row) => row.dispatchId === opts.dispatchId);
  if (!entry) throw policyError(`dispatchId absent from validated plan: ${opts.dispatchId}`);
  for (const field of ['dispatchId', 'unitId', 'class', 'role', 'vendor', 'model', 'effort', 'authorVendor']) {
    if ((opts[field] ?? null) !== (entry[field] ?? null)) throw policyError(`dispatch differs from validated plan: ${field}`);
  }
  for (const field of ['escalation', 'escalationReason']) {
    if (Object.hasOwn(opts, field) && opts[field] !== entry[field]) throw policyError(`dispatch differs from validated plan: ${field}`);
  }
  if (fs.realpathSync(opts.cwd) !== fs.realpathSync(entry.cwd)) throw policyError('dispatch differs from validated plan: cwd');
  if (fs.realpathSync(opts.brief) !== fs.realpathSync(entry.brief)) throw policyError('dispatch differs from validated plan: brief');
  if (sha256(fs.readFileSync(opts.brief)) !== entry.briefSha256) throw policyError('dispatch brief differs from validated plan');
  return { ...validated, entry: structuredClone(entry) };
}

function chooseRoute(matrix, { className, role, excludedVendors = [], availability = {}, allowEscalation = false, escalationReason = null }) {
  const list = matrix.classes?.[className]?.[role];
  if (!Array.isArray(list)) throw policyError(`no route for ${className}/${role}`);
  for (const route of [...list].sort((a, b) => a.priority - b.priority)) {
    if (excludedVendors.includes(route.vendor)) continue;
    const escalationOnly = route.escalationOnly || matrix.vendors[route.vendor].models[route.model].tier === 'frontier-plus';
    if (escalationOnly && !allowEscalation) continue;
    const candidate = {
      class: className,
      role,
      ...route,
      ...(escalationOnly ? { escalation: true, escalationReason } : {}),
    };
    const result = routeAllowed(matrix, candidate, availability);
    if (result.ok) return candidate;
  }
  throw policyError(`no eligible route for ${className}/${role}`);
}

function parseArgs(argv) {
  const out = {};
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (seen.has(flag)) throw argumentError(`duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === '--help' || flag === '-h') { out.help = true; continue; }
    if (['--plan', '--matrix', '--availability'].includes(flag)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw argumentError(`${flag} requires a value`);
      out[flag.slice(2)] = value;
      continue;
    }
    throw argumentError(`unknown option: ${flag}`);
  }
  return out;
}

function usage() { return 'Usage: node tools/dispatch-matrix.js --plan <plan.json> [--availability <availability.json>] [--matrix <dispatch-matrix.json>]'; }

function main(argv = process.argv.slice(2), io = process) {
  try {
    const opts = parseArgs(argv);
    if (opts.help) { io.stdout.write(`${usage()}\n`); return 0; }
    if (!opts.plan) throw argumentError('--plan is required');
    const matrix = loadMatrix(opts.matrix);
    const availability = loadAvailability(opts.availability);
    const { plan, planPath, ...result } = readValidatedPlan(opts.plan, undefined, matrix, availability);
    result.planId = plan.planId;
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const code = error.code || 'POLICY_FAIL';
    io.stderr.write(`${code}: ${error.message}\n`);
    return code === 'ARGUMENT_ERROR' ? 2 : 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { DEFAULT_MATRIX, DEFAULT_PROBE_MAX_AGE_MINUTES, bindDispatch, chooseRoute, loadAvailability, loadMatrix, probeIsFresh, readValidatedPlan, routeAllowed, sha256, validatePlan, main };
