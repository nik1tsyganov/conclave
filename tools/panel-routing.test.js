// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

// The Swift suite's routing cases, run against the port. Every case here has a twin in the
// Droppy Code harness; when one moves, both move.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const routing = require('./panel-routing.js');

const ALL = ['openai', 'anthropic', 'google'];
const unit = (id, extra = {}) => ({ id, task: 't', brief: 'b', files: [], ...extra });

test('a panel runs only when every seat is ready', () => {
  assert.equal(routing.readiness(null, ALL).canRun, true);
  assert.equal(routing.readiness(null, ALL).crossVendor, true);

  const two = routing.readiness(null, ['openai', 'anthropic']);
  assert.equal(two.canRun, false, 'a seat with no vendor set up stops the panel');
  assert.equal(two.missing.length, 1);
  assert.match(two.missing[0].words, /not set up here/);

  // Three seats on one vendor is a panel, and the words say what it costs.
  const one = routing.readiness(
    [{ slot: 'ponens', vendor: 'anthropic' }, { slot: 'scrutator', vendor: 'anthropic' }, { slot: 'advocatus', vendor: 'anthropic' }],
    ['anthropic'],
  );
  assert.equal(one.canRun, true);
  assert.equal(one.crossVendor, false);
  assert.match(one.words, /one vendor/);
  assert.match(one.words, /which checks were not independent/);
});

test('a seat on a vendor that cannot hold one says so differently', () => {
  const state = routing.readiness([{ slot: 'ponens', vendor: 'cursor' }], [...ALL, 'cursor']);
  assert.equal(state.canRun, false);
  assert.match(state.missing[0].words, /cannot hold a seat/);
  assert.equal(state.missing[0].reason, 'cannotHoldSeat');
});

test('the builder never checks its own work, and the other two do', () => {
  for (const unitClass of routing.CLASSES) {
    const out = routing.route({ units: [unit('U1', { class: unitClass })], readyVendors: ALL });
    const routed = out.units[0];
    const checkers = routed.checkers.map((c) => c.slot);
    assert.ok(!checkers.slice(0, 2).includes(routed.builder), `${unitClass}: the builder does not check itself`);
    assert.equal(new Set([routed.builder, ...checkers]).size, 3, `${unitClass}: all three seats are used`);
    assert.deepEqual(routed.checkers.slice(0, 2).map((c) => c.role), ['verify', 'review']);
  }
});

test('a security unit is read a third time, by the seat that verified it', () => {
  const out = routing.route({ units: [unit('C1', { class: 'security-sensitive' })], readyVendors: ALL });
  const routed = out.units[0];
  assert.equal(routed.checkers.length, 3);
  assert.equal(routed.checkers[2].role, 'review');
  assert.equal(routed.checkers[2].slot, routed.checkers[0].slot, 'the verifier reads it again, in a session of its own');

  const off = routing.route({ units: [unit('C1', { class: 'security-sensitive' })], readyVendors: ALL, criticalTwoReviews: false });
  assert.equal(off.units[0].checkers.length, 2, 'turned off, it is an ordinary unit');
});

test('the routing this produced for the live security unit', () => {
  // The live run routed C1 as: built by the Anthropic seat, verified by the OpenAI seat,
  // reviewed by the Google seat, and reviewed again by the OpenAI seat. This is that case.
  const routed = routing.route({ units: [unit('C1', { class: 'security-sensitive' })], readyVendors: ALL }).units[0];
  assert.equal(routed.builder, 'scrutator', 'anthropic builds security work');
  assert.deepEqual(routed.checkers, [
    { role: 'verify', slot: 'ponens' },
    { role: 'review', slot: 'advocatus' },
    { role: 'review', slot: 'ponens' },
  ]);
});

test('a block does not land on one seat while two sit idle', () => {
  const units = ['A', 'B', 'C'].map((id) => unit(id, { files: [`${id}.swift`] }));
  const builders = routing.route({ units, readyVendors: ALL }).units.map((u) => u.builder);
  assert.equal(new Set(builders).size, 3, 'three units, three builders');
});

test('two units cannot claim one file, however it is spelled', () => {
  const out = routing.route({
    units: [unit('U1', { files: ['src/stats.py'] }), unit('U2', { files: ['./SRC/stats.py'] })],
    readyVendors: ALL,
  });
  assert.equal(out.units.length, 1, 'the later unit goes back');
  assert.equal(out.dropped[0].unitId, 'U2');
  assert.match(out.dropped[0].reason, /already U1's file/);
});

test('a block may ask for more than goes out, and hears which did not', () => {
  const units = Array.from({ length: routing.MAX_UNITS + 2 }, (_, i) => unit(`U${i + 1}`, { files: [`${i}.swift`] }));
  const out = routing.route({ units, readyVendors: ALL });
  assert.equal(out.units.length, routing.MAX_UNITS);
  assert.equal(out.dropped.length, 2);
  assert.match(out.dropped[0].reason, /Only 8 units go out at a time/);
});

test('a panel that cannot run drops every unit with the reason', () => {
  const out = routing.route({ units: [unit('U1'), unit('U2')], readyVendors: ['openai'] });
  assert.equal(out.units.length, 0);
  assert.equal(out.dropped.length, 2);
  assert.match(out.dropped[0].reason, /needs all three seats ready/);
});

// The Swift harness used to brute-force every arrangement of three seats over every class.
// That sweep belongs wherever the routing lives, so it lives here now.
test('every arrangement of three seats, over every class, routes soundly', () => {
  const vendors = ['openai', 'anthropic', 'google'];
  let arrangements = 0;
  for (const a of vendors) for (const b of vendors) for (const c of vendors) {
    const seats = [{ slot: 'ponens', vendor: a }, { slot: 'scrutator', vendor: b }, { slot: 'advocatus', vendor: c }];
    const ready = [...new Set([a, b, c])];
    for (const unitClass of routing.CLASSES) {
      arrangements += 1;
      const out = routing.route({ units: [unit('U1', { class: unitClass })], seats, readyVendors: ready });
      const routed = out.units[0];
      const where = `${a}/${b}/${c} ${unitClass}`;
      assert.ok(routed, `${where}: a panel of ready seats always routes`);
      assert.ok(!routed.checkers.slice(0, 2).some((c2) => c2.slot === routed.builder), `${where}: the builder never checks its own work`);
      assert.equal(new Set([routed.builder, ...routed.checkers.map((c2) => c2.slot)]).size, 3, `${where}: all three seats sit`);
      assert.equal(routed.checkers.length, routing.isCritical(unitClass) ? 3 : 2, `${where}: the right number of checks`);
      assert.deepEqual(routed.checkers.slice(0, 2).map((c2) => c2.role), ['verify', 'review'], `${where}: one verify then one review`);
      // A panel on one vendor still runs; it is the verdict that says what that cost.
      assert.equal(out.readiness.canRun, true, `${where}: it runs`);
      assert.equal(out.readiness.crossVendor, new Set([a, b, c]).size === 3, `${where}: and says how independent it is`);
    }
  }
  assert.equal(arrangements, 27 * routing.CLASSES.length, 'every arrangement of three seats over every class');
});

// The same sweep for how a block of several units is spread, which is where the load counting
// shows: one seat must not author a whole block while the other two sit idle.
test('a block of three spreads across the seats in every arrangement', () => {
  const vendors = ['openai', 'anthropic', 'google'];
  for (const a of vendors) for (const b of vendors) for (const c of vendors) {
    const seats = [{ slot: 'ponens', vendor: a }, { slot: 'scrutator', vendor: b }, { slot: 'advocatus', vendor: c }];
    const units = ['A', 'B', 'C'].map((id) => unit(id, { files: [`${id}.swift`] }));
    const builders = routing.route({ units, seats, readyVendors: [...new Set([a, b, c])] }).units.map((u) => u.builder);
    assert.equal(new Set(builders).size, 3, `${a}/${b}/${c}: three units, three builders`);
  }
});

test('a class is read however it is spelled, and naming nothing is ordinary work', () => {
  assert.equal(routing.classNamed('security-sensitive'), 'security-sensitive');
  assert.equal(routing.classNamed('Security Sensitive'), 'security-sensitive', 'however it is spelled');
  assert.equal(routing.classNamed('bulk_mechanical'), 'bulk-mechanical');
  // Naming NOTHING cannot escalate anything, so it is the class that asks least.
  assert.equal(routing.classNamed(undefined), 'standard-feature');
  assert.equal(routing.classNamed(null), 'standard-feature');
  assert.equal(routing.classNamed('   '), 'standard-feature');
});

// Before 2026-09-18 a misspelt class became standard-feature in silence, so a unit the lead
// called security-sensitive was checked twice instead of three times with nothing to say so.
test('a class this panel does not have is refused, never downgraded', () => {
  for (const wrong of ['securty-sensitive', 'security-sensitve', 'made-up-nonsense', 'SECURITY!!']) {
    assert.throws(() => routing.classNamed(wrong), RangeError, `${wrong} must refuse`);
  }
  assert.throws(() => routing.classNamed(7), TypeError, 'a non-string class is an error, not a default');
  for (const unroutable of routing.UNROUTABLE_CLASSES) {
    assert.throws(() => routing.classNamed(unroutable), /no implement or verify lane/,
      `${unroutable}: a matrix class this panel cannot seat refuses with its own reason`);
  }
});

test('route drops a unit whose class it cannot seat, rather than routing it as something easier', () => {
  const out = routing.route({
    units: [unit('GOOD', { class: 'security-sensitive', files: ['a.js'] }),
            unit('TYPO', { class: 'securty-sensitive', files: ['b.js'] })],
    readyVendors: ALL,
  });
  assert.deepEqual(out.units.map((u) => u.id), ['GOOD'], 'the sound unit still goes out');
  assert.equal(out.units[0].checkers.length, 3, 'and a security unit still gets its second review');
  assert.equal(out.dropped.length, 1);
  assert.equal(out.dropped[0].unitId, 'TYPO');
  assert.match(out.dropped[0].reason, /unknown task class/, 'and the lead hears exactly why');
});

// classNamed and isCritical disagreed about 'security_sensitive': one normalised it, the other
// compared the raw string. isCritical now reads through classNamed, so they cannot part again.
test('classNamed and isCritical agree about every input, legal or not', () => {
  const spellings = [
    ...routing.CLASSES,
    ...routing.CLASSES.map((c) => c.replace(/-/g, '_')),
    ...routing.CLASSES.map((c) => c.toUpperCase()),
    ...routing.CLASSES.map((c) => c.replace(/-/g, ' ')),
    undefined, null, '',
  ];
  for (const raw of spellings) {
    const named = routing.classNamed(raw);
    assert.equal(routing.isCritical(raw), named === 'security-sensitive',
      `${JSON.stringify(raw)}: isCritical must answer for the class classNamed resolved`);
  }
  for (const wrong of ['securty-sensitive', 'made-up-nonsense']) {
    assert.throws(() => routing.isCritical(wrong), RangeError,
      `${wrong}: isCritical refuses what classNamed refuses`);
  }
});

// The matrix is the source; this module copies it because it ships in conclave-mcp and the
// matrix does not. That copy is only safe if a divergence fails here.
test('the routable and unroutable classes together are exactly the matrix classes', () => {
  const matrix = require(path.join(__dirname, '..', '.cursor', 'skills', 'conclave-cli', 'references', 'dispatch-matrix.json'));
  const inMatrix = Object.keys(matrix.classes).sort();
  const known = [...routing.CLASSES, ...routing.UNROUTABLE_CLASSES].sort();
  assert.deepEqual(known, inMatrix,
    'a class added to the dispatch matrix must be added here too, as routable or as unroutable');
  assert.equal(new Set(known).size, known.length, 'and named once');
  // Routability is decided per lane, never over a pooled list: pooling implement and verify
  // let a class with vendors in one lane and none in the other pass for routable, which is
  // how a buildable class with no review lane once shipped unlandable.
  const matrixIds = Object.keys(matrix.classes);
  assert.ok(matrixIds.length > 0, 'the matrix must name classes, or every lane check below is vacuous');
  for (const id of routing.CLASSES) {
    const lanes = matrix.classes[id];
    const verdict = routing.routability(lanes);
    assert.ok(verdict.routable, `${id} is routable here, so the matrix must agree (${verdict.reason || 'no reason given'})`);
    assert.ok((lanes.verify || []).length > 0, `${id} is routable here, so the matrix must give it a verify lane`);
    if ((lanes.implement || []).length > 0) {
      assert.ok((lanes.review || []).length > 0, `${id} can be built, so the matrix must give it a review lane too`);
    }
    assert.ok(routing.BUILDER_PREFERENCE[id], `${id} is routable here, so it needs a builder preference`);
  }
  for (const id of routing.UNROUTABLE_CLASSES) {
    const verdict = routing.routability(matrix.classes[id]);
    assert.equal(verdict.routable, false, `${id} is refused here, so the matrix must agree`);
    assert.equal(routing.UNROUTABLE_REASON[id], verdict.reason,
      `${id}: the refusal must name the lane the matrix actually lacks`);
  }
});

// A class that can be built but not reviewed is the trap this rule closes: its plans seal,
// its seats run, and run-finalize can never land the unit for want of a review lane.
test('a buildable class missing a checking lane is not routable, and the refusal names the lane', () => {
  const noReview = routing.routability({ implement: ['openai'], verify: ['anthropic'], review: [] });
  assert.equal(noReview.routable, false, 'implement + verify without review cannot route');
  assert.match(noReview.reason, /implement lane but no review lane/, 'the refusal names the missing lane');

  const noVerify = routing.routability({ implement: ['openai'], verify: [], review: ['anthropic'] });
  assert.equal(noVerify.routable, false, 'implement + review without verify cannot route');
  assert.match(noVerify.reason, /implement lane but no verify lane/);

  // The exemption: a class this runtime does not build keeps a verify lane's routability.
  assert.equal(routing.routability({ verify: ['openai'] }).routable, true, 'verify-only still routes');
  assert.equal(routing.routability({ review: ['openai'] }).routable, false, 'a review lane alone never did route');
  assert.ok(routing.CLASSES.includes('test-verification'), 'the verify-only class the exemption exists for');

  // And the refusal a lead reads names the class and the lane it lacks.
  assert.throws(() => routing.classNamed('review-adversarial'),
    /review-adversarial is a matrix class with no implement or verify lane, so this panel cannot seat it/);
});

test('a seat the caller left out is filled in rather than refused', () => {
  const panel = routing.ordered([{ slot: 'advocatus', vendor: 'openai' }]);
  assert.deepEqual(panel.map((s) => s.slot), routing.SLOTS, 'always three, always in panel order');
  assert.equal(panel[2].vendor, 'openai', 'the one given keeps its vendor');
});
