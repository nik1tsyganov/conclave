#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_MATRIX, loadAvailability, loadMatrix, readValidatedPlan, validatePlan } = require('./dispatch-matrix.js');
const { DEFAULT_PROFILES } = require('./seat-policy.js');
const { ATTESTATION_PROTOCOL, hashFile, writeJson } = require('./dispatch-evidence.js');
const { readJsonFile } = require('./json-file.js');
const { canonicalPlainPath, pathsOverlap, DEFAULT_ROOT } = require('./runtime-paths.js');

function sealPlan({ plan, runDir, availability }) {
  if (!plan || !runDir) throw new Error('--plan and --run-dir are required');
  const available = loadAvailability(availability);
  const validated = readValidatedPlan(plan, undefined, loadMatrix(), available);
  // Keep the producer's path spelling in evidence; native paths are for containment.
  const root = path.resolve(runDir);
  const canonicalRoot = canonicalPlainPath(root);
  if (pathsOverlap(canonicalRoot, canonicalPlainPath(DEFAULT_ROOT))) throw new Error('run directory and runtime overlap');
  const planPath = path.join(root, 'dispatch-plan.json');
  const sealPath = path.join(root, 'plan-seal.json');
  const availablePath = path.join(root, 'availability.json');
  if (fs.existsSync(sealPath)) throw new Error('run directory already has a sealed plan; use a new run directory');
  for (const entry of validated.plan.dispatches) {
    if (!entry.brief || hashFile(entry.brief) !== entry.briefSha256) throw new Error(`brief file/hash mismatch: ${entry.dispatchId}`);
    const cwd = canonicalPlainPath(entry.cwd);
    if (!fs.statSync(cwd).isDirectory()) throw new Error(`cwd must be a directory: ${entry.dispatchId}`);
    if (pathsOverlap(canonicalRoot, cwd)) throw new Error(`run directory and product worktree overlap: ${entry.dispatchId}`);
  }
  const sourcePlan = canonicalPlainPath(validated.planPath);
  const sourceIsOutput = sourcePlan === canonicalPlainPath(planPath);
  for (const file of [planPath, availablePath, sealPath]) {
    canonicalPlainPath(file);
    if (fs.existsSync(file) && !(file === planPath && sourceIsOutput)) throw new Error(`run output already exists: ${file}`);
  }
  fs.mkdirSync(root, { recursive: true });
  if (!sourceIsOutput) fs.copyFileSync(sourcePlan, planPath, fs.constants.COPYFILE_EXCL);
  writeJson(availablePath, available);
  const seal = { schemaVersion: 1, planId: validated.plan.planId, planHash: validated.planHash, matrixSha256: hashFile(DEFAULT_MATRIX), profilesSha256: hashFile(DEFAULT_PROFILES), availabilitySha256: hashFile(availablePath), sealedAt: new Date().toISOString(), attestationProtocol: ATTESTATION_PROTOCOL };
  writeJson(sealPath, seal);
  return { ...seal, planPath, runDir: root };
}
function readSealedRun(runDir) {
  const root = fs.realpathSync(runDir);
  const sealPath = path.join(root, 'plan-seal.json');
  const seal = JSON.parse(fs.readFileSync(sealPath, 'utf8'));
  const planPath = path.join(root, 'dispatch-plan.json');
  const availablePath = path.join(root, 'availability.json');
  if (seal.planHash !== hashFile(planPath) || seal.matrixSha256 !== hashFile(DEFAULT_MATRIX) || seal.profilesSha256 !== hashFile(DEFAULT_PROFILES) || seal.availabilitySha256 !== hashFile(availablePath)) throw new Error('sealed run inputs changed');
  const plan = readJsonFile(planPath);
  if (plan.planId !== seal.planId || !Number.isFinite(Date.parse(seal.sealedAt))) throw new Error('invalid run seal');
  const matrix = loadMatrix();
  validatePlan(plan, matrix, loadAvailability(availablePath), Date.parse(seal.sealedAt));
  return { root, sealPath, seal, planPath, availablePath, plan, matrix };
}
function main(argv = process.argv.slice(2)) {
  try {
    const opts = {};
    for (let i = 0; i < argv.length; i += 2) {
      if (!['--plan', '--run-dir', '--availability'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Usage: plan-seal --plan <json> --run-dir <new directory> [--availability <json>]');
      const key = argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (Object.hasOwn(opts, key)) throw new Error(`duplicate plan-seal option: ${argv[i]}`);
      opts[key] = argv[i + 1];
    }
    process.stdout.write(`${JSON.stringify(sealPlan(opts))}\n`); return 0;
  } catch (error) { process.stderr.write(`PLAN_SEAL_FAIL: ${error.message}\n`); return 1; }
}
if (require.main === module) process.exitCode = main();
module.exports = { main, readSealedRun, sealPlan };
