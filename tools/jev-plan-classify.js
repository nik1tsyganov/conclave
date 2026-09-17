#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
// Asks the Jev decision engine (the CONCLAVE arbiter since 2026-09-16) for a routing
// class distribution per unit of a draft plan and writes a record bound to each
// brief's hash. plan-seal reads the record with --jev-classification and gates
// it; this tool proposes, the seal decides. One batched request per unit.
const fs = require('node:fs');
const path = require('node:path');
const { classifyTask } = require('./jev-arbiter.js');
const { loadMatrix } = require('./dispatch-matrix.js');
const { readJsonFile } = require('./json-file.js');
const { hashFile, writeJson } = require('./dispatch-evidence.js');

const PROTOCOL = 'conclave-jev-plan-classify-v1';

function routingFromMatrix(matrix) {
  const gates = matrix.arbiter?.decisionEngine?.gates || {};
  return {
    classes: Object.fromEntries(Object.entries(matrix.classes).map(([id, c]) => [id, { title: c.title || id }])),
    'decisionMatrix2026-09-16': { policy: { route: gates.classifyRoute ?? 0.6, routeFlag: gates.classifyRouteFlagged ?? 0.4 } },
  };
}

async function classifyPlan({ plan, out, provenance, matrix = loadMatrix(), systemOne }) {
  if (!plan || !out) throw new Error('--plan and --out are required');
  const draft = readJsonFile(plan);
  if (!Array.isArray(draft.dispatches) || !draft.dispatches.length) throw new Error('plan.dispatches must be non-empty');
  const routing = routingFromMatrix(matrix);
  const units = new Map();
  for (const entry of draft.dispatches) {
    const unit = units.get(entry.unitId) || { brief: null, briefSha256: null };
    if (!unit.brief || entry.role === 'implement') { unit.brief = entry.brief; unit.briefSha256 = entry.briefSha256; }
    units.set(entry.unitId, unit);
  }
  const implementUnits = new Set(draft.dispatches.filter(e => e.role === 'implement').map(e => e.unitId)).size;
  const record = { protocol: PROTOCOL, planId: draft.planId, classifiedAt: new Date().toISOString(), engine: matrix.arbiter?.decisionEngine?.model || 'jev', units: {}, requests: 0 };
  for (const [unitId, unit] of units) {
    if (!unit.brief || hashFile(unit.brief) !== unit.briefSha256) throw new Error(`brief file/hash mismatch for ${unitId}`);
    const result = await classifyTask({ briefText: fs.readFileSync(unit.brief, 'utf8'), unitCount: implementUnits }, routing, { provenancePath: provenance, systemOne });
    record.requests += 1;
    if (!result.ok) throw new Error(`Jev NOT_RUN for ${unitId}: ${result.notRun}`);
    record.units[unitId] = { briefSha256: unit.briefSha256, classId: result.classId, p: result.p, confidence: result.confidence, gate: result.gate, distribution: result.distribution, usage: result.usage || null };
  }
  writeJson(path.resolve(out), record);
  return record;
}

async function main(argv = process.argv.slice(2)) {
  try {
    const opts = {};
    for (let i = 0; i < argv.length; i += 2) {
      if (!['--plan', '--out', '--provenance'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Usage: jev-plan-classify --plan <draft.json> --out <record.json> [--provenance <jsonl>]');
      opts[argv[i].slice(2)] = argv[i + 1];
    }
    const record = await classifyPlan(opts);
    process.stdout.write(`${JSON.stringify({ ok: true, out: path.resolve(opts.out), requests: record.requests, units: Object.fromEntries(Object.entries(record.units).map(([u, r]) => [u, { classId: r.classId, p: r.p, gate: r.gate }])) })}\n`);
    return 0;
  } catch (error) { process.stderr.write(`JEV_CLASSIFY_FAIL: ${error.message}\n`); return 1; }
}

if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { PROTOCOL, classifyPlan, routingFromMatrix };
