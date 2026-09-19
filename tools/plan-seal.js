#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_MATRIX, loadAvailability, loadMatrix, readValidatedPlan, sha256, validatePlan } = require('./dispatch-matrix.js');
const { DEFAULT_PROFILES, buildSeatProfile } = require('./seat-policy.js');
const { bindSkillSource } = require('./cli-skill-stage.js');
const { ATTESTATION_PROTOCOL, hashFile, writeJson } = require('./dispatch-evidence.js');
const { readJsonFile } = require('./json-file.js');
const { canonicalPlainPath, pathsOverlap, DEFAULT_ROOT } = require('./runtime-paths.js');
const { loadCatalog, narrowMatrix } = require('./synara-catalog.js');
const { INSTRUCTION_READ_PROTOCOL } = require('./instruction-read-evidence.js');
const { validateEvidenceReadDirs } = require('./evidence-read-access.js');
const { readJsonFile: readJevRecord } = require('./json-file.js');

// Jev is the arbiter (2026-09-16). `node tools/jev-plan-classify.js` asks the
// decision engine for a class distribution per unit and writes a record bound to
// each brief's hash; plan-seal reads that record (--jev-classification) and gates
// it deterministically: the plan's class must be Jev's choice, or carry at least
// the flag-gate probability, or the seal records an explicit --class-override
// reason. Without a record the seal refuses unless --no-jev <reason> is given.
function jevClassifyPlan(plan, matrix, { noJev, classOverride, jevClassification } = {}) {
  const engine = matrix.arbiter?.decisionEngine || {};
  const gates = engine.gates || {};
  const policy = { route: gates.classifyRoute ?? 0.6, routeFlag: gates.classifyRouteFlagged ?? 0.4 };
  const record = { engine: engine.engine || 'jev', model: engine.model || null, gates: policy, units: {} };
  if (noJev) {
    if (jevClassification) throw new Error('--no-jev and --jev-classification are mutually exclusive');
    return { ...record, status: 'NOT_RUN', optOutReason: String(noJev) };
  }
  if (!jevClassification) throw new Error('Jev classification is required: run tools/jev-plan-classify.js and pass --jev-classification <file>, or record an opt-out with --no-jev <reason>');
  const classified = readJevRecord(jevClassification);
  if (classified.protocol !== 'conclave-jev-plan-classify-v1' || !classified.units || typeof classified.units !== 'object') throw new Error('Jev classification record is malformed');
  const units = new Map();
  for (const entry of plan.dispatches) {
    const unit = units.get(entry.unitId) || { classes: new Set(), briefSha256: null };
    unit.classes.add(entry.class);
    if (!unit.briefSha256 || entry.role === 'implement') unit.briefSha256 = entry.briefSha256;
    units.set(entry.unitId, unit);
  }
  for (const [unitId, unit] of units) {
    const row = classified.units[unitId];
    if (!row) throw new Error(`Jev classification record has no row for ${unitId}`);
    if (row.briefSha256 !== unit.briefSha256) throw new Error(`Jev classification for ${unitId} is bound to a different brief`);
    if (typeof row.classId !== 'string' || !row.distribution || typeof row.distribution !== 'object') throw new Error(`Jev classification for ${unitId} is incomplete`);
    const planClasses = [...unit.classes];
    const agrees = planClasses.includes(row.classId);
    const pPlan = Math.max(...planClasses.map(c => Number(row.distribution[c]) || 0));
    const out = { jevClass: row.classId, p: row.p, confidence: row.confidence, gate: row.gate, planClasses, pPlan, agrees };
    if (!agrees && pPlan < policy.routeFlag) {
      if (!classOverride) throw new Error(`Jev classifies ${unitId} as ${row.classId} (p=${row.p}); the plan's class ${planClasses.join('/')} has p=${pPlan}; pass --class-override <reason> to seal anyway`);
      out.override = String(classOverride);
    } else if (!agrees) out.flag = 'plan-class-below-route-but-above-flag';
    record.units[unitId] = out;
  }
  return { ...record, status: 'RUN', recordSha256: hashFile(jevClassification), recordPath: path.resolve(jevClassification) };
}

function matrixForPlan(plan, catalog, base = loadMatrix()) {
  if (!catalog) return base;
  return narrowMatrix(base, catalog).matrix;
}

/// A unit that names a check must hand the result to its checking seats.
///
/// This refuses rather than repairs. The sealed plan is a byte copy of the authored one so
/// its hash means something, and a sealer that edited the plan would be signing something
/// nobody wrote. Refusing also puts the directory in front of the author, who is the one who
/// knows whether a seat should read the run's own evidence or somewhere else.
///
/// Without it, the omission is invisible until launch: a sandboxed seat tries to run the
/// check itself, agy soft-denies a permission it cannot prompt for and answers SUCCESS having
/// done nothing, and the seat is failed for missing proof rather than for the reason.
function requireUnitCheckEvidence(plan, runDir) {
  const checked = new Set(plan.dispatches.filter((entry) => entry.check && entry.check.command).map((entry) => entry.unitId));
  if (!checked.size) return;
  const suggested = (unitId) => path.join(path.dirname(path.resolve(runDir)), 'evidence', unitId);
  for (const entry of plan.dispatches) {
    if (!['verify', 'review'].includes(entry.role) || !checked.has(entry.unitId)) continue;
    if (Array.isArray(entry.evidenceReadDirs) && entry.evidenceReadDirs.length) continue;
    throw new Error(
      `unit ${entry.unitId} names a check and ${entry.dispatchId} has nowhere to read its result: `
      + `add "evidenceReadDirs": ["${suggested(entry.unitId)}"] to that entry. `
      + 'The driver writes the check output and the diff there after the implement phase.',
    );
  }
}

/// A unit that builds on another unit must name it, and the named graph must be able to run.
///
/// This refuses rather than repairs. Dropping an unsatisfiable edge would seal a plan whose
/// seats then build in an order the author never agreed to, and picking an order is the
/// driver's job, not the sealer's.
///
/// Without it, the omission is invisible until a caller in one unit reaches a symbol another
/// unit never added: the dependent unit lands first and the plan has landed half a feature.
function requireUnitDependencies(plan) {
  const implementUnits = new Set(plan.dispatches.filter((entry) => entry.role === 'implement').map((entry) => entry.unitId));
  const dependencies = new Map();
  for (const entry of plan.dispatches) {
    if (entry.role !== 'implement' || !Array.isArray(entry.dependsOn) || !entry.dependsOn.length) continue;
    for (const dependency of entry.dependsOn) {
      if (dependency === entry.unitId) throw new Error(`unit ${entry.unitId} depends on itself`);
      if (!implementUnits.has(dependency)) throw new Error(`unit ${entry.unitId} depends on ${dependency}, which has no implement entry in the plan`);
    }
    dependencies.set(entry.unitId, entry.dependsOn);
  }
  // Iterative depth-first cycle detection; a recursion into authored data needs a visited set.
  const state = new Map();
  for (const start of dependencies.keys()) {
    if (state.has(start)) continue;
    const pathStack = [start];
    const stack = [[start, 0]];
    state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const deps = dependencies.get(top[0]) || [];
      if (top[1] < deps.length) {
        const next = deps[top[1]++];
        if (state.get(next) === 1) {
          const cycle = [...pathStack.slice(pathStack.indexOf(next)), next];
          throw new Error(`unit dependency cycle: ${cycle.join(' -> ')}`);
        }
        if (!state.has(next) && dependencies.has(next)) {
          state.set(next, 1);
          pathStack.push(next);
          stack.push([next, 0]);
        }
      } else {
        state.set(top[0], 2);
        pathStack.pop();
        stack.pop();
      }
    }
  }
}

/// Two implement units that can run at the same time may not write the same file.
///
/// This refuses rather than repairs. Which unit should own the file is the author's call,
/// and a sealer that silently picked one would be signing an order nobody declared.
///
/// A declared dependsOn exempts the pair, directly or transitively: the dependency waves
/// then order the writes, and the second unit edits what the first produced.
///
/// Without it, the omission is invisible until the wave runs: both seats snapshot the
/// worktree, both write the file, and the second to finish sees no change of its own and
/// dies with `SCOPE_FAIL: implementation produced no covered file change` - a message that
/// reads as a seat that did nothing when in fact two seats collided.
function requireDistinctWriteScopes(plan) {
  // requireUnitDependencies has already run: the graph is acyclic and every named
  // dependency exists, so a plain iterative walk over the same map reaches a fixpoint.
  const dependencies = new Map();
  const byCwd = new Map();
  for (const entry of plan.dispatches) {
    if (entry.role !== 'implement') continue;
    if (Array.isArray(entry.dependsOn) && entry.dependsOn.length) dependencies.set(entry.unitId, entry.dependsOn);
    const cwd = canonicalPlainPath(entry.cwd);
    const group = byCwd.get(cwd) || [];
    group.push(entry);
    byCwd.set(cwd, group);
  }
  const reaches = (from, target) => {
    const visited = new Set([from]);
    const stack = [...(dependencies.get(from) || [])];
    while (stack.length) {
      const next = stack.pop();
      if (next === target) return true;
      if (visited.has(next)) continue;
      visited.add(next);
      stack.push(...(dependencies.get(next) || []));
    }
    return false;
  };
  for (const group of byCwd.values()) {
    for (let i = 0; i < group.length; i += 1) {
      const scope = new Set((group[i].writeScope || []).map((file) => path.normalize(file)));
      for (let j = i + 1; j < group.length; j += 1) {
        const shared = (group[j].writeScope || []).map((file) => path.normalize(file)).find((file) => scope.has(file));
        if (!shared) continue;
        if (reaches(group[i].unitId, group[j].unitId) || reaches(group[j].unitId, group[i].unitId)) continue;
        throw new Error(
          `units ${group[i].unitId} (${group[i].dispatchId}) and ${group[j].unitId} (${group[j].dispatchId}) both write ${shared} `
          + 'in the same worktree and may run concurrently: declare a dependsOn between them to make the shared file legal',
        );
      }
    }
  }
}

function sealPlan({ plan, runDir, availability, synaraCatalog, skillSourceRoot, noJev, classOverride, jevClassification }) {
  if (!plan || !runDir) throw new Error('--plan and --run-dir are required');
  const available = loadAvailability(availability);
  const sealedAt = new Date().toISOString();
  const matrixText = fs.readFileSync(DEFAULT_MATRIX, 'utf8');
  const profilesText = fs.readFileSync(DEFAULT_PROFILES, 'utf8');
  const draft = readJsonFile(plan);
  if (draft.hostMode === 'synara' && !synaraCatalog) throw new Error('synara hostMode requires --synara-catalog');
  const catalog = synaraCatalog ? loadCatalog(synaraCatalog) : null;
  const validated = readValidatedPlan(plan, undefined, matrixForPlan(draft, catalog, JSON.parse(matrixText)), available, Date.parse(sealedAt));
  const profiles = JSON.parse(profilesText);
  const skillSource = bindSkillSource({ sourceRoot: skillSourceRoot, skills: [...new Set(validated.plan.dispatches.flatMap(entry => buildSeatProfile(profiles, entry).skills))] });
  // Keep the producer's path spelling in evidence; native paths are for containment.
  const root = path.resolve(runDir);
  const canonicalRoot = canonicalPlainPath(root);
  if (pathsOverlap(canonicalRoot, canonicalPlainPath(DEFAULT_ROOT))) throw new Error('run directory and runtime overlap');
  const jevClassify = jevClassifyPlan(validated.plan, JSON.parse(matrixText), { noJev, classOverride, jevClassification });
  const planPath = path.join(root, 'dispatch-plan.json');
  const sealPath = path.join(root, 'plan-seal.json');
  const availablePath = path.join(root, 'availability.json');
  if (fs.existsSync(sealPath)) throw new Error('run directory already has a sealed plan; use a new run directory');
  // A unit that names a check must say where its checkers read the result.
  requireUnitCheckEvidence(validated.plan, root);
  // A unit's dependencies must be units the plan itself builds, in a graph that can run.
  requireUnitDependencies(validated.plan);
  // Concurrent units in one worktree may not write the same file.
  requireDistinctWriteScopes(validated.plan);
  for (const entry of validated.plan.dispatches) {
    if (!entry.brief || hashFile(entry.brief) !== entry.briefSha256) throw new Error(`brief file/hash mismatch: ${entry.dispatchId}`);
    const cwd = canonicalPlainPath(entry.cwd);
    if (!fs.statSync(cwd).isDirectory()) throw new Error(`cwd must be a directory: ${entry.dispatchId}`);
    if (pathsOverlap(canonicalRoot, cwd)) throw new Error(`run directory and product worktree overlap: ${entry.dispatchId}`);
    validateEvidenceReadDirs(entry, { plan: validated.plan, runDir: root, forbiddenRoots: [skillSource.sourceRoot] });
  }
  const sourcePlan = canonicalPlainPath(validated.planPath);
  const sourceIsOutput = sourcePlan === canonicalPlainPath(planPath);
  const catalogPath = path.join(root, 'synara-catalog.json');
  for (const file of [planPath, availablePath, sealPath, ...(catalog ? [catalogPath] : [])]) {
    canonicalPlainPath(file);
    if (fs.existsSync(file) && !(file === planPath && sourceIsOutput)) throw new Error(`run output already exists: ${file}`);
  }
  fs.mkdirSync(root, { recursive: true });
  if (!sourceIsOutput) fs.copyFileSync(sourcePlan, planPath, fs.constants.COPYFILE_EXCL);
  writeJson(availablePath, available);
  if (catalog) writeJson(catalogPath, catalog);
  const seal = {
    schemaVersion: 2, planId: validated.plan.planId, planHash: validated.planHash,
    matrixSha256: sha256(matrixText), profilesSha256: sha256(profilesText),
    matrixText, profilesText, skillSource,
    availabilitySha256: hashFile(availablePath), sealedAt,
    attestationProtocol: ATTESTATION_PROTOCOL,
    instructionReadProtocol: INSTRUCTION_READ_PROTOCOL,
    ...(catalog ? { synaraCatalogSha256: hashFile(catalogPath) } : {}),
    jevClassify,
  };
  writeJson(sealPath, seal);
  return { ...seal, planPath, runDir: root };
}
function readSealedRun(runDir) {
  const root = fs.realpathSync(runDir);
  const sealPath = path.join(root, 'plan-seal.json');
  const seal = JSON.parse(fs.readFileSync(sealPath, 'utf8'));
  const planPath = path.join(root, 'dispatch-plan.json');
  const availablePath = path.join(root, 'availability.json');
  if (![1, 2].includes(seal.schemaVersion)) throw new Error('unsupported run seal version');
  if (seal.instructionReadProtocol !== undefined && seal.instructionReadProtocol !== INSTRUCTION_READ_PROTOCOL) throw new Error('unsupported instruction read protocol');
  if (seal.planHash !== hashFile(planPath) || seal.availabilitySha256 !== hashFile(availablePath)) throw new Error('sealed run inputs changed');
  if (seal.schemaVersion === 1 && (seal.matrixSha256 !== hashFile(DEFAULT_MATRIX) || seal.profilesSha256 !== hashFile(DEFAULT_PROFILES))) throw new Error('unsupported historical policy: original runtime policy hashes do not match');
  if (seal.schemaVersion === 2 && (typeof seal.matrixText !== 'string' || typeof seal.profilesText !== 'string' ||
    sha256(seal.matrixText) !== seal.matrixSha256 || sha256(seal.profilesText) !== seal.profilesSha256)) throw new Error('sealed run policy snapshots changed');
  const plan = readJsonFile(planPath);
  if (plan.planId !== seal.planId || !Number.isFinite(Date.parse(seal.sealedAt))) throw new Error('invalid run seal');
  let catalog = null;
  if (seal.synaraCatalogSha256) {
    const catalogPath = path.join(root, 'synara-catalog.json');
    if (hashFile(catalogPath) !== seal.synaraCatalogSha256) throw new Error('sealed run inputs changed');
    catalog = loadCatalog(catalogPath);
  }
  const matrixBase = seal.schemaVersion === 2 ? JSON.parse(seal.matrixText) : loadMatrix();
  const matrix = matrixForPlan(plan, catalog, matrixBase);
  validatePlan(plan, matrix, loadAvailability(availablePath), Date.parse(seal.sealedAt));
  for (const entry of plan.dispatches) validateEvidenceReadDirs(entry, { plan, runDir: root, forbiddenRoots: [seal.skillSource?.sourceRoot].filter(Boolean) });
  return { root, sealPath, seal, planPath, availablePath, plan, matrix };
}
function main(argv = process.argv.slice(2)) {
  try {
    const opts = {};
    for (let i = 0; i < argv.length; i += 2) {
      if (!['--plan', '--run-dir', '--availability', '--synara-catalog', '--skill-source-root', '--no-jev', '--class-override', '--jev-classification'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
        throw new Error('Usage: plan-seal --plan <json> --run-dir <new directory> [--availability <json>] [--synara-catalog <json>] [--skill-source-root <dir>] [--jev-classification <file> | --no-jev <reason>] [--class-override <reason>]');
      }
      const key = argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (Object.hasOwn(opts, key)) throw new Error(`duplicate plan-seal option: ${argv[i]}`);
      opts[key] = argv[i + 1];
    }
    process.stdout.write(`${JSON.stringify(sealPlan(opts))}\n`); return 0;
  } catch (error) { process.stderr.write(`PLAN_SEAL_FAIL: ${error.message}\n`); return 1; }
}
if (require.main === module) process.exitCode = main();
module.exports = { main, readSealedRun, requireDistinctWriteScopes, requireUnitCheckEvidence, requireUnitDependencies, sealPlan };
