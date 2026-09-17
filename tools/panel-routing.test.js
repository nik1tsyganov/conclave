// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

// The Swift suite's routing cases, run against the port. Every case here has a twin in the
// Droppy Code harness; when one moves, both move.

const test = require('node:test');
const assert = require('node:assert/strict');
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

test('a class nobody recognises is ordinary feature work', () => {
  assert.equal(routing.classNamed('security-sensitive'), 'security-sensitive');
  assert.equal(routing.classNamed('Security Sensitive'), 'security-sensitive', 'however it is spelled');
  assert.equal(routing.classNamed('bulk_mechanical'), 'bulk-mechanical');
  assert.equal(routing.classNamed('something new'), 'standard-feature');
  assert.equal(routing.classNamed(undefined), 'standard-feature');
  assert.equal(routing.isCritical('security-sensitive'), true);
  assert.equal(routing.isCritical('standard-feature'), false);
});

test('a seat the caller left out is filled in rather than refused', () => {
  const panel = routing.ordered([{ slot: 'advocatus', vendor: 'openai' }]);
  assert.deepEqual(panel.map((s) => s.slot), routing.SLOTS, 'always three, always in panel order');
  assert.equal(panel[2].vendor, 'openai', 'the one given keeps its vendor');
});
