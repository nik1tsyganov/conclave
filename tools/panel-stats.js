#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

// What the panel bought, and what the arbiter cost.
//
// Two questions this project has to be able to answer about itself with numbers rather than
// belief, both read from committed tally receipts and never from a model:
//
//   --benefit  Would one seat have decided the same thing? Every unit where the seats did not
//              agree, or where an approval was downgraded for carrying no reason of its own,
//              is a unit a single model would have waved through. That difference is the whole
//              argument for the panel, so it is counted, not asserted.
//
//   --bias     Does the arbiter score its own vendor's seats differently? Only meaningful when
//              the arbiter shares a vendor with a seat. Both arbiters on record (jev, xai) are
//              independent, so there is no measured baseline for a seated one — the tool says
//              so rather than printing a reassuring zero.
//
// FLOOR is the honesty gate. Below it every figure is printed and none is called a result:
// four units is an anecdote and this file will not dress one up as a rate.

const fs = require('node:fs');
const path = require('node:path');

/// Units below which a proportion is an anecdote. Not tuned — chosen so that a single unit
/// cannot move a reported rate by more than five points, and revisited when a measured noise
/// floor exists to replace it.
const FLOOR = 20;

function readTallies(roots) {
  const files = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth > 0) walk(full, depth - 1);
      else if (e.isFile() && /^jev-tally-.*\.json$/.test(e.name)) files.push(full);
    }
  };
  for (const root of roots) walk(root, 3);
  const units = [];
  for (const file of files.sort()) {
    let d;
    try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    const seats = Array.isArray(d.seats) ? d.seats : [];
    if (seats.length === 0) continue;                       // a tally with no seat reported measures nothing
    let arbiter = null;
    const plan = path.join(path.dirname(file), 'dispatch-plan.json');
    if (fs.existsSync(plan)) {
      try { arbiter = JSON.parse(fs.readFileSync(plan, 'utf8')).arbiter || null; } catch { /* unreadable plan, arbiter unknown */ }
    }
    units.push({ file, run: path.basename(path.dirname(file)), unitId: d.unitId, author: d.author || null,
      verdict: d.verdict, seats, replies: Array.isArray(d.replies) ? d.replies : [],
      flags: Array.isArray(d.flags) ? d.flags : [], arbiter });
  }
  return units;
}

function benefit(units) {
  const seatOf = (u, seat) => (u.seats.find((s) => s.seat === seat) || {});
  let divergent = 0, loneRejection = 0, downgradedReplies = 0, stoppedWithAnApproval = 0;
  const loneDissentBy = {};
  const downgradedBy = {};
  for (const u of units) {
    const positions = u.seats.map((s) => s.position);
    if (new Set(positions).size > 1) divergent += 1;
    const rejects = u.seats.filter((s) => s.position === 'REJECT');
    if (rejects.length === 1 && u.seats.length > 1) {
      loneRejection += 1;
      loneDissentBy[rejects[0].vendor] = (loneDissentBy[rejects[0].vendor] || 0) + 1;
    }
    for (const r of u.replies) {
      if (r.counted !== r.declared) {
        downgradedReplies += 1;
        const v = seatOf(u, r.seat).vendor || 'unknown';
        downgradedBy[v] = (downgradedBy[v] || 0) + 1;
      }
    }
    if (u.verdict !== 'PASSAGE' && positions.includes('APPROVE')) stoppedWithAnApproval += 1;
  }
  return {
    units: units.length,
    divergent,
    loneRejection,
    downgradedReplies,
    // The headline: a unit that did not land although a seat approved it is a unit that a
    // single approving model would have let through.
    stoppedWithAnApproval,
    loneDissentBy,
    downgradedBy,
    measured: units.length >= FLOOR,
  };
}

function bias(units) {
  const arbiters = {};
  for (const u of units) {
    const key = u.arbiter ? `${u.arbiter.vendor}/${u.arbiter.model}` : 'unknown';
    const seatVendors = new Set(u.seats.map((s) => s.vendor));
    const a = arbiters[key] || (arbiters[key] = {
      vendor: u.arbiter ? u.arbiter.vendor : null, units: 0, seated: 0,
      sameVendor: [], foreignVendor: [], flags: {},
    });
    a.units += 1;
    if (a.vendor && seatVendors.has(a.vendor)) a.seated += 1;
    for (const r of u.replies) {
      const seat = u.seats.find((s) => s.seat === r.seat);
      if (!seat || typeof r.evidenceP !== 'number') continue;
      (a.vendor && seat.vendor === a.vendor ? a.sameVendor : a.foreignVendor).push(r.evidenceP);
    }
    for (const f of u.flags) a.flags[f] = (a.flags[f] || 0) + 1;
  }
  const mean = (xs) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null);
  for (const a of Object.values(arbiters)) {
    a.sameVendorMeanEvidenceP = mean(a.sameVendor);
    a.foreignVendorMeanEvidenceP = mean(a.foreignVendor);
    a.gap = a.sameVendorMeanEvidenceP !== null && a.foreignVendorMeanEvidenceP !== null
      ? Number((a.sameVendorMeanEvidenceP - a.foreignVendorMeanEvidenceP).toFixed(4)) : null;
    a.independence = a.seated === 0 ? 'independent' : 'seated';
    a.sameVendorScores = a.sameVendor.length; a.foreignVendorScores = a.foreignVendor.length;
    delete a.sameVendor; delete a.foreignVendor;
    a.measured = a.units >= FLOOR && a.independence === 'seated';
  }
  return { arbiters, floor: FLOOR };
}

function render(report) {
  const out = [];
  const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(0)}%` : '—');
  const b = report.benefit;
  out.push('PANEL BENEFIT  — would one seat have decided the same?');
  out.push(`  units with a reported seat        ${b.units}`);
  out.push(`  seats disagreed                   ${b.divergent}  (${pct(b.divergent, b.units)})`);
  out.push(`  exactly one seat rejected         ${b.loneRejection}  <- would have landed on the other seat alone`);
  out.push(`  approvals downgraded by the rule  ${b.downgradedReplies}  <- carried no reason of their own`);
  out.push(`  stopped although a seat approved  ${b.stoppedWithAnApproval}  (${pct(b.stoppedWithAnApproval, b.units)})  <- the panel's whole claim`);
  if (Object.keys(b.loneDissentBy).length) out.push(`  lone dissent by vendor            ${JSON.stringify(b.loneDissentBy)}`);
  if (Object.keys(b.downgradedBy).length) out.push(`  downgraded by vendor              ${JSON.stringify(b.downgradedBy)}`);
  out.push(b.measured ? '  READ AS A RATE.' : `  UNMEASURED as a rate: ${b.units} of ${FLOOR} units needed. The counts above are real; the percentages are anecdote.`);
  out.push('');
  out.push('ARBITER BIAS   — does the arbiter score its own vendor differently?');
  for (const [key, a] of Object.entries(report.bias.arbiters)) {
    out.push(`  ${key}`);
    out.push(`    units ${a.units}, ${a.independence}${a.seated ? ` (shared a vendor with a seat in ${a.seated})` : ''}`);
    if (a.independence === 'independent') {
      out.push('    no same-vendor seat to compare against, so no bias figure is computable.');
    } else {
      out.push(`    mean evidenceP  own vendor ${a.sameVendorMeanEvidenceP} (n=${a.sameVendorScores})  others ${a.foreignVendorMeanEvidenceP} (n=${a.foreignVendorScores})  gap ${a.gap}`);
      out.push(a.measured ? '    READ AS A RATE.' : `    UNMEASURED as a rate: ${a.units} of ${FLOOR} units needed.`);
    }
    if (Object.keys(a.flags).length) out.push(`    flags ${JSON.stringify(a.flags)}`);
  }
  if (!Object.keys(report.bias.arbiters).length) out.push('  no tally carried an arbiter declaration.');
  return out.join('\n');
}

function report(roots) {
  const units = readTallies(roots);
  return { units: units.length, benefit: benefit(units), bias: bias(units) };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const roots = [];
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    if ((args[i] === '--run-dir' || args[i] === '--runs') && args[i + 1]) { roots.push(args[i + 1]); i += 1; }
    else if (args[i] === '--json') json = true;
  }
  if (roots.length === 0) {
    console.error('usage: node tools/panel-stats.js --run-dir <dir> [--run-dir <dir>...] [--json]');
    process.exit(2);
  }
  const out = report(roots);
  console.log(json ? JSON.stringify(out, null, 2) : render(out));
}

module.exports = { FLOOR, readTallies, benefit, bias, report, render };
