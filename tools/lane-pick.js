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

/// Seat a whole panel for a class: who builds, who verifies, who reviews.
///
/// No slot is tied to a vendor. Any vendor, model and effort the class's lanes allow may hold
/// any seat; the order they come out in is decided by lane priority and by what has a passing
/// probe, never by position. Independence is the only structural constraint: the builder is
/// recused from the count, so the two checking seats must sit on two vendors, neither of them
/// the builder's - a panel that cannot reach two approving vendors cannot pass, and refusing
/// here costs nothing where discovering it after three live dispatches costs three.
///
/// `prefer` lets a caller pin any seat (`{ implement: 'google' }`) and the rest seats around it.
function seatPanel(classId, available, { prefer = {}, matrix = loadMatrix() } = {}) {
  const seats = {};
  const taken = [];
  // Pinned seats are placed first, so pinning a vendor re-seats the others around it rather
  // than colliding with whoever the free pass happened to take.
  const roles = ['implement', 'verify', 'review'];
  const order = [...roles.filter((r) => prefer[r]), ...roles.filter((r) => !prefer[r])];
  for (const role of order) {
    // Every seat excludes every vendor already seated, the builder included. The builder is
    // recused from the count, so a checking seat on its vendor would be an elector that cannot
    // vote; and two checking seats on one vendor are one elector casting both votes. All three
    // distinct is the only arrangement that can reach two approving vendors.
    const exclude = [...taken];
    const wanted = prefer[role];
    const picked = pickLane(classId, role, available, { excludeVendors: exclude, matrix });
    let lane = picked.ok ? picked.lane : null;
    if (wanted) {
      const pinned = lanesFor(matrix, classId, role)
        .find((l) => l.vendor === wanted && !exclude.includes(l.vendor) && isAvailable(available, l));
      if (!pinned) {
        return { ok: false, reason: `${role} was pinned to ${wanted}, which has no available lane for ${classId}${exclude.includes(wanted) ? ' and is already seated' : ''}` };
      }
      lane = pinned;
    }
    if (!lane) return { ok: false, reason: picked.reason, seats };
    seats[role] = lane;
    taken.push(lane.vendor);
  }
  const checkingVendors = new Set([seats.verify.vendor, seats.review.vendor]);
  if (checkingVendors.size < 2) {
    return { ok: false, reason: `both checking seats landed on ${[...checkingVendors][0]}, so one elector would cast both votes`, seats };
  }
  return { ok: true, seats, vendors: taken };
}

module.exports = { lanesFor, isAvailable, pickLane, seatPanel };

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
