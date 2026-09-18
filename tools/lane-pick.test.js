// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { lanesFor, pickLane } = require('./lane-pick.js');
const { loadMatrix } = require('./dispatch-matrix.js');

const matrix = loadMatrix();
const all = (classId, role) => lanesFor(matrix, classId, role)
  .map((l) => ({ vendor: l.vendor, model: l.model, effort: l.effort, status: 'PASS' }));

test('lanes come back best first', () => {
  const lanes = lanesFor(matrix, 'standard-feature', 'implement');
  const priorities = lanes.map((l) => l.priority ?? 99);
  assert.deepEqual(priorities, [...priorities].sort((a, b) => a - b), 'sorted by priority');
});

test('the best available lane wins when everything can run', () => {
  const picked = pickLane('standard-feature', 'implement', all('standard-feature', 'implement'));
  assert.equal(picked.ok, true);
  assert.equal(picked.lane.priority, 1, 'nothing is blocked, so the first rung is taken');
});

// The point of the whole file: a rung that cannot run yields to the next instead of failing
// the run. Measured 2026-09-18 - Fable refused a checking launch and the CLI answered on
// Opus 4.8; agy soft-denied a headless permission and returned SUCCESS having done nothing.
test('an unavailable rung falls through to the next that can run', () => {
  const lanes = all('standard-feature', 'verify');
  const first = lanesFor(matrix, 'standard-feature', 'verify')[0];
  const degraded = lanes.filter((l) => !(l.vendor === first.vendor && l.model === first.model));
  const picked = pickLane('standard-feature', 'verify', degraded);
  assert.equal(picked.ok, true, 'a lane below the top still runs');
  assert.notEqual(picked.lane.model, first.model, 'and it is not the rung that cannot answer');
  assert.ok(picked.considered.some((c) => c.why === 'no passing probe'), 'it says why it skipped');
});

test('a checking seat never falls onto the vendor that built the unit', () => {
  const lanes = all('standard-feature', 'review');
  const picked = pickLane('standard-feature', 'review', lanes, { excludeVendors: ['openai'] });
  assert.equal(picked.ok, true);
  assert.notEqual(picked.lane.vendor, 'openai', 'independence survives the fallback');
});

test('nothing available is a refusal that names every rung it tried', () => {
  const picked = pickLane('standard-feature', 'verify', []);
  assert.equal(picked.ok, false);
  assert.match(picked.reason, /no verify lane for standard-feature can run/);
  assert.match(picked.reason, /no passing probe/);
});

test('an unroutable class refuses rather than guessing', () => {
  assert.throws(() => lanesFor(matrix, 'research-synthesis', 'implement'), /has no implement lane/);
  assert.throws(() => lanesFor(matrix, 'made-up-nonsense', 'implement'), /unknown class/);
});

// No seat is tied to a vendor. Owner requirement 2026-09-18: any vendor, model and effort may
// hold any seat, decided by lane priority and availability rather than by position.
const { seatPanel } = require('./lane-pick.js');
const everything = (classId) => ['implement', 'verify', 'review']
  .flatMap((role) => (matrix.classes[classId][role] || [])
    .map((l) => ({ vendor: l.vendor, model: l.model, effort: l.effort, status: 'PASS' })));

test('a seated panel puts three different vendors in three seats', () => {
  for (const classId of Object.keys(matrix.classes).filter((c) => matrix.classes[c].implement)) {
    const seated = seatPanel(classId, everything(classId));
    assert.equal(seated.ok, true, `${classId}: ${seated.reason || ''}`);
    const vendors = ['implement', 'verify', 'review'].map((r) => seated.seats[r].vendor);
    assert.equal(new Set(vendors).size, 3, `${classId} seated ${vendors} - the builder is recused, so a checker on its vendor cannot vote`);
  }
});

test('any vendor can be pinned to any seat, and the rest re-seat around it', () => {
  const classId = 'standard-feature';
  const lanes = everything(classId);
  for (const role of ['implement', 'verify', 'review']) {
    for (const vendor of ['openai', 'anthropic', 'google']) {
      const seated = seatPanel(classId, lanes, { prefer: { [role]: vendor } });
      assert.equal(seated.ok, true, `${vendor} pinned to ${role}: ${seated.reason || ''}`);
      assert.equal(seated.seats[role].vendor, vendor, 'the pin is honoured');
      const vendors = ['implement', 'verify', 'review'].map((r) => seated.seats[r].vendor);
      assert.equal(new Set(vendors).size, 3, 'and the others move out of its way');
    }
  }
});

test('one usable vendor refuses, and names every rung it tried', () => {
  const onlyOne = everything('bulk-mechanical').filter((l) => l.vendor === 'openai');
  const seated = seatPanel('bulk-mechanical', onlyOne);
  assert.equal(seated.ok, false);
  assert.match(seated.reason, /vendor already seated|no passing probe/);
});
