#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MATRIX = path.resolve(__dirname, '..', '.cursor', 'skills', 'magi-cli', 'references', 'dispatch-matrix.json');

function argumentError(message) { const e = new Error(message); e.code = 'ARGUMENT_ERROR'; return e; }
function policyError(message) { const e = new Error(message); e.code = 'POLICY_FAIL'; return e; }

function loadMatrix(file = DEFAULT_MATRIX) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function loadAvailability(file) {
  if (!file) return {};
  try { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }
  catch (error) { throw argumentError(`cannot read availability file: ${error.message}`); }
}

function routeAllowed(matrix, route, availability = {}) {
  const cls = matrix.classes?.[route.class];
  if (!cls) return { ok: false, reason: `unknown class ${route.class}` };
  const list = cls[route.role];
  if (!Array.isArray(list)) return { ok: false, reason: `class ${route.class} has no ${route.role} lane` };
  const matched = list.find((entry) => entry.vendor === route.vendor && entry.model === route.model && entry.effort === route.effort);
  if (!matched) return { ok: false, reason: `route not in matrix: ${route.class}/${route.role} ${route.vendor}/${route.model}/${route.effort}` };
  const modelSpec = matrix.vendors?.[route.vendor]?.models?.[route.model];
  if (!modelSpec) return { ok: false, reason: `model absent from vendor catalog: ${route.vendor}/${route.model}` };
  if (!modelSpec.efforts.includes(route.effort)) return { ok: false, reason: `effort ${route.effort} unsupported by ${route.model}` };
  if ((matched.requiresProbe || modelSpec.availability === 'probe-required')) {
    const observed = availability?.vendors?.[route.vendor]?.models?.[route.model];
    if (!observed || observed.available !== true || observed.observedModel !== route.model) {
      return { ok: false, reason: `probe-required route unavailable: ${route.vendor}/${route.model}` };
    }
  }
  return { ok: true, route: matched };
}

function validatePlan(plan, matrix, availability = {}) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw policyError('plan must be an object');
  if (plan.hostMode !== 'cursor-cli') throw policyError('hostMode must be cursor-cli');
  if (plan.arbiter?.vendor !== 'xai') throw policyError('arbiter vendor must be xai');
  if (plan.arbiter?.model !== matrix.principles.arbiterModel) throw policyError(`arbiter model must be ${matrix.principles.arbiterModel}`);
  if (!['high', 'xhigh'].includes(plan.arbiter?.effort)) throw policyError('arbiter effort must be high or xhigh');
  if (!Array.isArray(plan.dispatches) || plan.dispatches.length === 0) throw policyError('plan.dispatches must be non-empty');

  const implement = [];
  for (const route of plan.dispatches) {
    if (route.vendor === 'xai') throw policyError('arbiter/xai may not occupy a seat');
    if (!['implement', 'review', 'verify'].includes(route.role)) throw policyError(`invalid role: ${route.role}`);
    const allowed = routeAllowed(matrix, route, availability);
    if (!allowed.ok) throw policyError(allowed.reason);
    if (route.role === 'implement') implement.push(route);
    if (route.authorVendor && route.authorVendor === route.vendor && (route.role === 'review' || route.role === 'verify')) {
      throw policyError(`same-vendor ${route.role} forbidden for ${route.unitId || 'unit'}`);
    }
  }

  if (plan.magiConvened === true) {
    const vendors = new Set(implement.map((r) => r.vendor));
    if (vendors.size < 3) throw policyError(`MAGI convened requires 3 implement vendors, got ${vendors.size}`);
  }
  if (implement.length > 0) {
    const counts = new Map();
    for (const row of implement) counts.set(row.vendor, (counts.get(row.vendor) || 0) + 1);
    for (const [vendor, count] of counts) {
      if (count / implement.length > matrix.principles.distributionFloor) throw policyError(`distribution floor exceeded by ${vendor}`);
    }
  }

  return { ok: true, dispatches: plan.dispatches.length };
}

function chooseRoute(matrix, { className, role, excludedVendors = [], availability = {} }) {
  const list = matrix.classes?.[className]?.[role];
  if (!Array.isArray(list)) throw policyError(`no route for ${className}/${role}`);
  for (const route of [...list].sort((a, b) => a.priority - b.priority)) {
    if (excludedVendors.includes(route.vendor)) continue;
    const result = routeAllowed(matrix, { class: className, role, ...route }, availability);
    if (result.ok) return { class: className, role, ...route };
  }
  throw policyError(`no eligible route for ${className}/${role}`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
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
    const plan = JSON.parse(fs.readFileSync(path.resolve(opts.plan), 'utf8'));
    const matrix = loadMatrix(opts.matrix);
    const availability = loadAvailability(opts.availability);
    const result = validatePlan(plan, matrix, availability);
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const code = error.code || 'POLICY_FAIL';
    io.stderr.write(`${code}: ${error.message}\n`);
    return code === 'ARGUMENT_ERROR' ? 2 : 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { DEFAULT_MATRIX, chooseRoute, loadAvailability, loadMatrix, routeAllowed, validatePlan, main };
