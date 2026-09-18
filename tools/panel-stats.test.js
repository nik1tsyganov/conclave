// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const stats = require('./panel-stats.js');

function runDir(units, arbiter = { vendor: 'jev', model: 'jev-latest' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-stats-'));
  const run = path.join(root, 'run1');
  fs.mkdirSync(run);
  fs.writeFileSync(path.join(run, 'dispatch-plan.json'), JSON.stringify({ arbiter }));
  units.forEach((u, i) => fs.writeFileSync(path.join(run, `jev-tally-u${i}.json`), JSON.stringify(u)));
  return root;
}
const unit = (seats, replies, verdict, flags = []) => ({
  unitId: 'u', author: 'openai', verdict, seats, replies, flags,
});
const seat = (s, vendor, role, position) => ({ seat: s, vendor, role, position });
const reply = (s, declared, counted, evidenceP) => ({ seat: s, declared, counted, evidenceP });

test('a tally with no seat reported measures nothing and is skipped', () => {
  const root = runDir([unit([], [], 'NOT_PANEL')]);
  assert.equal(stats.report([root]).units, 0, 'an unrun panel is not a data point');
});

test('the seats agreeing is not counted as the panel doing work', () => {
  const root = runDir([unit(
    [seat('A', 'anthropic', 'verify', 'APPROVE'), seat('B', 'google', 'review', 'APPROVE')],
    [reply('A', 'APPROVE', 'APPROVE', 0.8), reply('B', 'APPROVE', 'APPROVE', 0.9)], 'PASSAGE')]);
  const b = stats.report([root]).benefit;
  assert.equal(b.units, 1);
  assert.equal(b.divergent, 0);
  assert.equal(b.stoppedWithAnApproval, 0, 'it landed, so the panel changed nothing here');
});

// The number the whole panel argument rests on.
test('a unit stopped although a seat approved it is the panel doing work', () => {
  const root = runDir([
    unit([seat('A', 'anthropic', 'verify', 'APPROVE'), seat('B', 'google', 'review', 'REJECT')],
      [reply('A', 'APPROVE', 'APPROVE', 0.88), reply('B', 'REJECT', 'REJECT', 0.77)], 'DEADLOCK'),
    unit([seat('A', 'openai', 'verify', 'APPROVE'), seat('B', 'anthropic', 'review', 'APPROVE')],
      [reply('A', 'APPROVE', 'ABSTAIN', 0.51), reply('B', 'APPROVE', 'APPROVE', 0.84)], 'DEADLOCK',
      ['approve-without-evidence-counted-as-abstain']),
  ]);
  const b = stats.report([root]).benefit;
  assert.equal(b.units, 2);
  assert.equal(b.divergent, 1, 'one unit had seats holding different positions');
  assert.equal(b.loneRejection, 1);
  assert.deepEqual(b.loneDissentBy, { google: 1 });
  assert.equal(b.downgradedReplies, 1, 'an approval carrying no reason of its own');
  assert.deepEqual(b.downgradedBy, { openai: 1 });
  assert.equal(b.stoppedWithAnApproval, 2, 'both would have landed on a single approving seat');
});

test('a proportion below the floor is printed and refused as a rate', () => {
  const root = runDir([unit([seat('A', 'anthropic', 'verify', 'APPROVE')], [reply('A', 'APPROVE', 'APPROVE', 0.8)], 'PASSAGE')]);
  const out = stats.report([root]);
  assert.equal(out.benefit.measured, false, `one unit is under the floor of ${stats.FLOOR}`);
  assert.match(stats.render(out), /UNMEASURED as a rate/);
  assert.match(stats.render(out), /units with a reported seat\s+1/, 'the count is still shown');
});

test('an independent arbiter yields no bias figure, and says so rather than printing a zero', () => {
  const root = runDir([unit(
    [seat('A', 'anthropic', 'verify', 'APPROVE'), seat('B', 'google', 'review', 'APPROVE')],
    [reply('A', 'APPROVE', 'APPROVE', 0.8), reply('B', 'APPROVE', 'APPROVE', 0.9)], 'PASSAGE')]);
  const a = stats.report([root]).bias.arbiters['jev/jev-latest'];
  assert.equal(a.independence, 'independent');
  assert.equal(a.gap, null, 'no same-vendor seat means no comparison exists');
  assert.match(stats.render(stats.report([root])), /no bias figure is computable/);
});

test('a seated arbiter is compared against itself, own vendor versus the rest', () => {
  const root = runDir([unit(
    [seat('A', 'anthropic', 'verify', 'APPROVE'), seat('B', 'google', 'review', 'APPROVE')],
    [reply('A', 'APPROVE', 'APPROVE', 0.9), reply('B', 'APPROVE', 'APPROVE', 0.6)], 'PASSAGE')],
  { vendor: 'anthropic', model: 'opus' });
  const a = stats.report([root]).bias.arbiters['anthropic/opus'];
  assert.equal(a.independence, 'seated');
  assert.equal(a.sameVendorMeanEvidenceP, 0.9, 'its own vendor');
  assert.equal(a.foreignVendorMeanEvidenceP, 0.6, 'everyone else');
  assert.equal(a.gap, 0.3, 'and the gap is the figure to argue about');
  assert.equal(a.measured, false, 'still under the floor, so still not a rate');
});
