#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

// Which model in a lane can actually run right now.
//
// A lane is an ordered preference, not a single choice: dispatch-matrix gives every class and role a
// list with a `priority`. Until now a plan named one model by hand, and a model that could not
// answer - an exhausted bucket, a safeguard refusal, a headless permission the vendor cannot
// prompt for - failed the whole run rather than yielding to the next rung.
//
// This picks at PLAN time, never at run time. That distinction is the whole point. A plan is
// sealed against one model and the proof gate refuses a seat that answered on another, so a
// runtime substitution is tampering by construction. Choosing which model to seal, before
// sealing, is just routing - and routing is allowed to prefer one that has proved it can run.
//
// Availability is the evidence, not an opinion: only a model with a fresh PASSING probe is
// eligible, which is the same record plan-seal already checks.

const { loadMatrix } = require('./dispatch-matrix.js');

/// Lanes for a class and role, best first. Equal priorities keep matrix order.
function lanesFor(matrix, classId, role) {
  const klass = matrix.classes?.[classId];
  if (!klass) throw new Error(`unknown class ${classId}`);
  const lanes = klass[role];
  if (!Array.isArray(lanes) || lanes.length === 0) throw new Error(`class ${classId} has no ${role} lane`);
  return lanes.map((lane, at) => ({ ...lane, at }))
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || a.at - b.at);
}

/// True when this exact vendor/model/effort has a passing entry in the availability record.
function isAvailable(available, lane) {
  const rows = Array.isArray(available) ? available : (available?.models || available?.entries || []);
  return rows.some((row) => row
    && row.vendor === lane.vendor
    && (row.model === lane.model || row.requestedModel === lane.model)
    && (row.effort === undefined || row.effort === lane.effort)
    && (row.status === undefined || row.status === 'PASS'));
}

/// The first lane that can run, skipping vendors the caller has already seated.
///
/// `excludeVendors` is how independence survives a fallback: a checking seat must not land on
/// the vendor that built the unit, and two checking seats on one vendor are a weaker panel, so
/// the caller names who is already sitting rather than discovering the clash after sealing.
function pickLane(classId, role, available, { excludeVendors = [], matrix = loadMatrix() } = {}) {
  const blocked = new Set(excludeVendors);
  const lanes = lanesFor(matrix, classId, role);
  const considered = [];
  for (const lane of lanes) {
    if (blocked.has(lane.vendor)) { considered.push({ lane, why: 'vendor already seated' }); continue; }
    if (!isAvailable(available, lane)) { considered.push({ lane, why: 'no passing probe' }); continue; }
    return { ok: true, lane, considered };
  }
  return {
    ok: false,
    lane: null,
    considered,
    reason: `no ${role} lane for ${classId} can run: ${considered.map((c) => `${c.lane.vendor}/${c.lane.model} (${c.why})`).join(', ')}`,
  };
}

module.exports = { lanesFor, isAvailable, pickLane };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? undefined : argv[i + 1]; };
  const classId = opt('class'); const role = opt('role'); const availPath = opt('availability');
  if (!classId || !role || !availPath) {
    process.stderr.write('Usage: lane-pick --class <id> --role <implement|verify|review> --availability <file> [--exclude a,b]\n');
    process.exit(1);
  }
  const available = JSON.parse(require('node:fs').readFileSync(availPath, 'utf8'));
  const excludeVendors = (opt('exclude') || '').split(',').filter(Boolean);
  const out = pickLane(classId, role, available, { excludeVendors });
  process.stdout.write(`${JSON.stringify(out.ok ? { ok: true, ...out.lane } : { ok: false, reason: out.reason })}\n`);
  process.exit(out.ok ? 0 : 4);
}
