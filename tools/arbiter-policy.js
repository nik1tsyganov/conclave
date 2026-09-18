#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

// Who may arbitrate, and what it costs when the arbiter is not a stranger to the room.
//
// The arbiter proposes: the task class, the seats, whether to convene, and how much
// independent evidence each reply carries. Deterministic code gates every proposal. Before
// 2026-09-18 the matrix pinned one vendor and one model, and a plan naming any other was
// refused. That was never a property the mechanism needed — the recorded runs used two
// different arbiters, xai/grok-4.6 and jev/jev-latest — and pinning it hid the question that
// actually matters, which is not WHICH arbiter but whether the arbiter is judging replies from
// its own vendor.
//
// So: any vendor, any model. One thing is refused and one thing is measured.
//
//   REFUSED   the arbiter's exact vendor+model also holding a seat in the same run. A model
//             scoring the independence of its own reply is not a check, and no statistic
//             rescues it.
//   MEASURED  the arbiter's VENDOR also holding a seat, on a different model. This is legal,
//             it is sometimes unavoidable on three vendors, and it is a bias risk: the run is
//             marked `seated` and `panel-stats.js --bias` reports how that arbiter scored its
//             own vendor's seats against the others.
//
// The recommendation, and the default in the matrix, is an arbiter from a vendor that holds no
// seat at all. Both arbiters on record were such: jev and xai are not seat vendors, so every
// measured run to date is `independent` and there is NO measured baseline for a seated one.
// That absence is the reason this file exists rather than a rule forbidding it.
//
// Pure: no filesystem, no network, no clock.

/// A run whose arbiter shares no vendor with any seat. The recommended arrangement.
const INDEPENDENT = 'independent';
/// A run whose arbiter shares a vendor with at least one seat, on a different model. Legal,
/// recorded, and reported on.
const SEATED = 'seated';
const INDEPENDENCE = Object.freeze([INDEPENDENT, SEATED]);

function policyError(message) {
  const error = new Error(message);
  error.code = 'ARBITER_POLICY_FAIL';
  return error;
}

const named = (value) => typeof value === 'string' && value.trim() !== '';

/// Reads an arbiter declaration, refusing only what no statistic can repair.
///
/// `seats` is any list of dispatch entries carrying `vendor` and `model`. Returns the arbiter
/// with its independence, the seats it shares a vendor with, and whether it matches the
/// matrix's recommendation — never a pass/fail on that recommendation, which is the operator's
/// call to make and this file's job to price.
function classifyArbiter(arbiter, seats = [], recommended = {}) {
  if (!arbiter || typeof arbiter !== 'object' || Array.isArray(arbiter)) {
    throw policyError('a plan must declare an arbiter {vendor, model}');
  }
  if (!named(arbiter.vendor)) throw policyError('arbiter.vendor must be a non-empty string');
  if (!named(arbiter.model)) throw policyError('arbiter.model must be a non-empty string');

  const vendor = arbiter.vendor.trim();
  const model = arbiter.model.trim();
  const entries = (Array.isArray(seats) ? seats : []).filter((s) => s && named(s.vendor));

  const identical = entries.filter((s) => s.vendor.trim() === vendor && String(s.model || '').trim() === model);
  if (identical.length > 0) {
    const where = identical.map((s) => s.dispatchId || s.role || 'a seat').join(', ');
    throw policyError(
      `${vendor}/${model} cannot arbitrate a run it also sits in (${where}): a model cannot score the independence of its own reply`
    );
  }

  const sharesVendorWith = entries
    .filter((s) => s.vendor.trim() === vendor)
    .map((s) => ({ dispatchId: s.dispatchId || null, role: s.role || null, model: String(s.model || '') || null }));

  const independence = sharesVendorWith.length === 0 ? INDEPENDENT : SEATED;
  return {
    vendor,
    model,
    independence,
    sharesVendorWith,
    matchesRecommendation: vendor === recommended.vendor && model === recommended.model,
    recommended: named(recommended.vendor) ? { vendor: recommended.vendor, model: recommended.model || null } : null,
    words: independence === INDEPENDENT
      ? `${vendor}/${model} holds no seat in this run; its proposals are foreign to every reply it scores.`
      : `${vendor}/${model} shares a vendor with ${sharesVendorWith.length} seat(s). Legal, and recorded: read panel-stats --bias before trusting its evidence scores.`,
  };
}

module.exports = { INDEPENDENT, SEATED, INDEPENDENCE, classifyArbiter };
