#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_MATRIX, loadAvailability, loadMatrix, readValidatedPlan, validatePlan } = require('./dispatch-matrix.js');
const { DEFAULT_PROFILES } = require('./seat-policy.js');
const { ATTESTATION_PROTOCOL, hashFile, writeJson } = require('./dispatch-evidence.js');

function sealPlan({ plan, runDir, availability }) {
  if (!plan || !runDir) throw new Error('--plan and --run-dir are required');
  const available = loadAvailability(availability);
  const validated = readValidatedPlan(plan, undefined, loadMatrix(), available);
  const root = path.resolve(runDir);
  fs.mkdirSync(root, { recursive: true });
  const planPath = path.join(root, 'dispatch-plan.json');
  const sealPath = path.join(root, 'plan-seal.json');
  if (fs.existsSync(sealPath)) throw new Error('run directory already has a sealed plan; use a new run directory');
  for (const entry of validated.plan.dispatches) {
    if (!entry.brief || hashFile(entry.brief) !== entry.briefSha256) throw new Error(`brief file/hash mismatch: ${entry.dispatchId}`);
    if (fs.realpathSync(entry.cwd) !== path.resolve(entry.cwd)) throw new Error(`cwd must use its real path: ${entry.dispatchId}`);
  }
  if (path.resolve(plan) !== planPath) fs.copyFileSync(plan, planPath, fs.constants.COPYFILE_EXCL);
  const availablePath = path.join(root, 'availability.json');
  if (fs.existsSync(availablePath)) throw new Error('run availability snapshot already exists');
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
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  if (plan.planId !== seal.planId || !Number.isFinite(Date.parse(seal.sealedAt))) throw new Error('invalid run seal');
  const matrix = loadMatrix();
  validatePlan(plan, matrix, loadAvailability(availablePath), Date.parse(seal.sealedAt));
  return { root, sealPath, seal, planPath, availablePath, plan, matrix };
}
function main(argv = process.argv.slice(2)) {
  try {
    const opts = {};
    for (let i = 0; i < argv.length; i += 2) {
      if (!['--plan', '--run-dir', '--availability'].includes(argv[i]) || !argv[i + 1]) throw new Error('Usage: plan-seal --plan <json> --run-dir <new directory> [--availability <json>]');
      opts[argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[i + 1];
    }
    process.stdout.write(`${JSON.stringify(sealPlan(opts))}\n`); return 0;
  } catch (error) { process.stderr.write(`PLAN_SEAL_FAIL: ${error.message}\n`); return 1; }
}
if (require.main === module) process.exitCode = main();
module.exports = { main, readSealedRun, sealPlan };
