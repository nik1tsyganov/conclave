#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

// Who builds a unit and who checks it.
//
// The second half of what a host cannot sensibly own. A host knows which seats it has and
// which vendors are set up on the machine; it should not also carry the table that says a
// mechanical sweep goes to Google and a debugging mystery goes to Anthropic, nor the counting
// that keeps one seat from authoring a whole block.
//
// Pure, like the tally: no filesystem, no network, no clock.

const SLOTS = Object.freeze(['ponens', 'scrutator', 'advocatus']);
const SEAT_VENDORS = Object.freeze(['openai', 'anthropic', 'google']);
const CLASSES = Object.freeze(['standard-feature', 'bulk-mechanical', 'debug-mystery', 'security-sensitive', 'test-verification']);

/// Units one block may ask for. Past this the lead hears which ones did not go out.
const MAX_UNITS = 8;
/// Distinct vendors the panel wants before it calls itself cross-vendor.
const VENDORS_FOR_FULL_INDEPENDENCE = 3;

/// Which vendor should build each class, best first. The measured routing table: OpenAI leads
/// ordinary feature work, Anthropic takes the classes that turn on judgement, Google takes the
/// wide mechanical sweeps. A seat pointed at a vendor not named here is routed by the panel's
/// own order instead, so the table guides and never blocks.
const BUILDER_PREFERENCE = Object.freeze({
  'standard-feature': ['openai', 'anthropic', 'google'],
  'bulk-mechanical': ['google', 'openai', 'anthropic'],
  'debug-mystery': ['anthropic', 'openai', 'google'],
  'security-sensitive': ['anthropic', 'openai', 'google'],
  'test-verification': ['openai', 'anthropic', 'google'],
});

const CHECKER_PREFERENCE = Object.freeze({
  'test-verification': ['openai', 'google', 'anthropic'],
  default: ['openai', 'anthropic', 'google'],
});

/// Security work is the one class where a single review is not enough to let a change land.
function isCritical(unitClass) {
  return unitClass === 'security-sensitive';
}

/// A class named in a block, however the lead spelled it. Anything unrecognised is ordinary
/// feature work, which is the class that asks least of the panel.
function classNamed(raw) {
  if (typeof raw !== 'string') return 'standard-feature';
  const key = raw.trim().toLowerCase().replace(/[\s_]+/g, '-');
  return CLASSES.includes(key) ? key : 'standard-feature';
}

/// The three seats in panel order, with any the caller left out filled in.
function ordered(seats) {
  return SLOTS.map((slot, index) => {
    const given = (seats || []).find((seat) => seat && seat.slot === slot);
    return { slot, vendor: (given && given.vendor) || SEAT_VENDORS[index], name: (given && given.name) || slot };
  });
}

/// Whether the panel can run with these seats, given the vendors set up on this machine.
///
/// Every seat must be ready. A unit cannot be checked by a seat whose vendor is missing, and
/// running with two seats would leave one reading and no count.
function readiness(seats, readyVendors) {
  const panel = ordered(seats);
  const available = new Set(readyVendors || []);
  const ready = panel.filter((seat) => SEAT_VENDORS.includes(seat.vendor) && available.has(seat.vendor));
  const missing = panel
    .filter((seat) => !ready.includes(seat))
    .map((seat) => ({
      slot: seat.slot,
      vendor: seat.vendor,
      reason: SEAT_VENDORS.includes(seat.vendor) ? 'notSetUp' : 'cannotHoldSeat',
      words: SEAT_VENDORS.includes(seat.vendor)
        ? `${seat.name} runs on ${seat.vendor}, which is not set up here`
        : `${seat.name} is on ${seat.vendor}, which cannot hold a seat`,
    }));
  const readyVendorCount = new Set(ready.map((seat) => seat.vendor)).size;
  const canRun = missing.length === 0;
  const crossVendor = canRun && readyVendorCount >= VENDORS_FOR_FULL_INDEPENDENCE;
  return {
    ready: ready.map((seat) => seat.slot),
    missing,
    vendors: new Set(panel.map((seat) => seat.vendor)).size,
    readyVendors: readyVendorCount,
    canRun,
    crossVendor,
    words: !canRun
      ? `${missing.map((m) => m.words).join(', ')}.`
      : crossVendor
        ? 'Three seats on three vendors: every check is foreign to the work it reads.'
        : `Three seats on ${readyVendorCount === 1 ? 'one vendor' : `${readyVendorCount} vendors`}. The panel still runs, and every verdict says which checks were not independent.`,
  };
}

/// A path reduced for comparison, so two units cannot claim one file under two spellings.
function normalizedPath(value) {
  return String(value || '').replace(/\/+/g, '/').replace(/^\.\//, '').replace(/\/$/, '').toLowerCase();
}

/// The seat to use: the least loaded one whose vendor the class prefers, and where the class
/// names no vendor the panel holds, the least loaded seat in panel order.
///
/// Load keeps a block of three units from landing on one seat while two sit idle.
function pick(panel, preference, load) {
  const rank = (seat) => {
    const at = preference.indexOf(seat.vendor);
    return at === -1 ? preference.length : at;
  };
  let best = panel[0];
  for (const seat of panel) {
    const here = load[seat.slot] || 0;
    const there = load[best.slot] || 0;
    if (here !== there) {
      if (here < there) best = seat;
      continue;
    }
    if (rank(seat) !== rank(best)) {
      if (rank(seat) < rank(best)) best = seat;
      continue;
    }
    if (SLOTS.indexOf(seat.slot) < SLOTS.indexOf(best.slot)) best = seat;
  }
  return best.slot;
}

/// Routes a block's units across the panel.
///
/// Seats may share a vendor; that is the user's arrangement to make, and each verdict records
/// what it cost. What is refused is a panel that cannot run at all.
function route({ units, seats, readyVendors, criticalTwoReviews = true } = {}) {
  if (!Array.isArray(units)) throw new TypeError('units must be an array');
  const panel = ordered(seats);
  const state = readiness(panel, readyVendors);
  if (!state.canRun) {
    const reason = `The panel needs all three seats ready: ${state.missing.map((m) => m.words).join('; ')}.`;
    return { units: [], dropped: units.map((unit) => ({ unitId: unit.id, reason })), readiness: state };
  }

  const routed = [];
  const dropped = [];
  const claimed = new Map();
  // Two counts, because they answer two questions. Who builds should vary so no one seat
  // authors the whole block, and who checks should vary so the subscriptions are spent
  // evenly. One shared counter let checking work decide authorship, which is neither's job.
  const builderLoad = {};
  const checkLoad = {};

  for (const unit of units.slice(0, MAX_UNITS)) {
    const files = Array.isArray(unit.files) ? unit.files : [];
    // Two seats editing one file is the split the lead was told not to make, and here it
    // would also make the landing patches fight. The later unit goes back.
    const clash = files.find((file) => claimed.has(normalizedPath(file)));
    if (clash !== undefined) {
      dropped.push({ unitId: unit.id, reason: `${clash} is already ${claimed.get(normalizedPath(clash))}'s file.` });
      continue;
    }
    for (const file of files) claimed.set(normalizedPath(file), unit.id);

    const unitClass = classNamed(unit.class);
    const builder = pick(panel, BUILDER_PREFERENCE[unitClass], builderLoad);
    builderLoad[builder] = (builderLoad[builder] || 0) + 1;
    const rest = panel.filter((seat) => seat.slot !== builder);

    const verifier = pick(rest, CHECKER_PREFERENCE[unitClass] || CHECKER_PREFERENCE.default, checkLoad);
    checkLoad[verifier] = (checkLoad[verifier] || 0) + 1;
    const reviewer = (rest.find((seat) => seat.slot !== verifier) || rest[0]).slot;
    checkLoad[reviewer] = (checkLoad[reviewer] || 0) + 1;

    const checkers = [{ role: 'verify', slot: verifier }, { role: 'review', slot: reviewer }];
    // A critical unit is reviewed twice: the seat that verified it reads it again as a
    // reviewer, in a session of its own, so two reviews stand behind anything security
    // sensitive.
    if (isCritical(unitClass) && criticalTwoReviews) {
      checkers.push({ role: 'review', slot: verifier });
      checkLoad[verifier] = (checkLoad[verifier] || 0) + 1;
    }
    routed.push({ ...unit, class: unitClass, builder, checkers });
  }

  for (const extra of units.slice(MAX_UNITS)) {
    dropped.push({ unitId: extra.id, reason: `Only ${MAX_UNITS} units go out at a time.` });
  }
  return { units: routed, dropped, readiness: state };
}

module.exports = {
  BUILDER_PREFERENCE, CHECKER_PREFERENCE, CLASSES, MAX_UNITS, SEAT_VENDORS, SLOTS,
  VENDORS_FOR_FULL_INDEPENDENCE,
  classNamed, isCritical, normalizedPath, ordered, readiness, route,
};
