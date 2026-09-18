// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

// These are the Swift suite's own cases, run against the port. Two implementations of one
// rule are two rules, and the only thing that stops them drifting is a shared set of cases
// that both have to answer the same way. Every case here has a twin in the Droppy Code
// harness; when one moves, both move.

const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('./panel-rules.js');

function receipt(slot, vendor, role, position, evidence, extra = {}) {
  return {
    slot, vendor, role, position, evidence,
    status: 'completed',
    sessionId: `session-${slot}-${role}`,
    tokens: 1234,
    modelObserved: 'a-model',
    treeBefore: 'a',
    treeAfter: 'a',
    ...extra,
  };
}

const BUILDER = receipt('ponens', 'openai', 'implement', null, null);
const GOOD = 'The six tests in stats_test.py pass, the even-length case included.';

test('agreement is not evidence, however it is punctuated', () => {
  for (const line of ['looks good', 'Looks good!', 'LGTM', 'lgtm -- nice one', 'Approved.',
                      'no issues found', 'all good', 'OK', 'seems correct', 'looks good to me, nice work']) {
    assert.equal(rules.judgeEvidence(line).independent, false, line);
  }
  assert.match(rules.judgeEvidence('looks good').reason, /agreed without a reason/);
  assert.match(rules.judgeEvidence('').reason, /gave no evidence line/);
  assert.match(rules.judgeEvidence(null).reason, /gave no evidence line/);
});

test('agreement that points at something is let through', () => {
  // "looks good" and then an anchor is a reason; the opening does not disqualify it.
  assert.equal(rules.judgeEvidence('looks good, the guard at stats.py:14 returns first').independent, true);
});

test('a phrase is too short to be a reading, by characters and by meaning', () => {
  assert.equal(rules.judgeEvidence('it compiles').independent, false);
  assert.equal(rules.judgeEvidence('and the it is of to in on at').independent, false, 'filler carries no meaning');
  assert.equal(rules.judgeEvidence(GOOD).independent, true);
});

test('an anchor is a path, a symbol, a quote, a number or an extension', () => {
  for (const line of ['see `median`', 'in src/stats.py', 'the "empty" case', 'line 42', 'stats.py']) {
    assert.equal(rules.hasAnchor(line), true, line);
  }
  assert.equal(rules.hasAnchor('it reads correctly to me'), false);
  assert.equal(rules.hasAnchor(null), false);
});

test('exactly one position line, with nothing after it but evidence', () => {
  assert.equal(rules.positionIn('POSITION: APPROVE'), 'APPROVE');
  assert.equal(rules.positionIn('waffle\nPOSITION: REJECT\nEVIDENCE: the third step is missing'), 'REJECT');
  assert.equal(rules.positionIn('POSITION: APPROVE\nPOSITION: REJECT'), null, 'hedging is not a vote');
  assert.equal(rules.positionIn('no position at all'), null);
  assert.equal(rules.positionIn('POSITION: MAYBE'), null);
  // A vote followed by an argument against itself is not an answer.
  assert.equal(rules.positionIn('POSITION: APPROVE\nthough actually I am not sure'), null);
  assert.equal(rules.positionIn('  POSITION:   ABSTAIN  '), 'ABSTAIN', 'whitespace is not meaning');
});

test('the evidence is the last line, because a reply may quote the contract first', () => {
  assert.equal(rules.evidenceIn('EVIDENCE: one sentence naming a check\n\nPOSITION: APPROVE\nEVIDENCE: the real one'), 'the real one');
  assert.equal(rules.evidenceIn('EVIDENCE:   '), null);
  assert.equal(rules.evidenceIn('nothing here'), null);
});

test('a vote counts only from a seat that can prove itself', () => {
  assert.equal(rules.receiptCounts(receipt('scrutator', 'anthropic', 'verify', 'APPROVE', GOOD)), true);
  for (const [field, value] of [['sessionId', ''], ['sessionId', '   '], ['tokens', null], ['tokens', 0], ['modelObserved', '']]) {
    const broken = receipt('scrutator', 'anthropic', 'verify', 'APPROVE', GOOD, { [field]: value });
    assert.equal(rules.receiptCounts(broken), false, `${field}=${JSON.stringify(value)}`);
  }
  assert.equal(rules.receiptCounts(receipt('scrutator', 'anthropic', 'verify', 'APPROVE', GOOD, { treeAfter: 'b' })), false, 'a checker that wrote does not count');
  assert.equal(rules.receiptCounts(receipt('scrutator', 'anthropic', 'verify', 'APPROVE', GOOD, { treeBefore: null, treeAfter: null })), false, 'a missing audit allows nothing');
  assert.equal(rules.receiptCounts(receipt('scrutator', 'anthropic', 'verify', 'APPROVE', GOOD, { status: 'failed' })), false);
  assert.equal(rules.receiptCounts(receipt('scrutator', 'anthropic', 'verify', 'APPROVE', GOOD, { voidReason: 'changed the files' })), false);
});

test('two reasoned approvals carry a unit and nothing else does', () => {
  const pass = rules.verdict({ receipts: [BUILDER,
    receipt('scrutator', 'anthropic', 'verify', 'APPROVE', GOOD),
    receipt('advocatus', 'google', 'review', 'APPROVE', 'I read the callers in app.py and none passes a tuple.')] });
  assert.equal(pass.outcome, 'PASSAGE');
  assert.equal(pass.lands, true);
  assert.deepEqual([pass.approve, pass.reject, pass.abstain], [2, 0, 0]);

  const rejected = rules.verdict({ receipts: [BUILDER,
    receipt('scrutator', 'anthropic', 'verify', 'REJECT', 'Step 3 is missing.'),
    receipt('advocatus', 'google', 'review', 'REJECT', 'The caller in app.py breaks.')] });
  assert.equal(rejected.outcome, 'REJECT');

  const split = rules.verdict({ receipts: [BUILDER,
    receipt('scrutator', 'anthropic', 'verify', 'APPROVE', GOOD),
    receipt('advocatus', 'google', 'review', 'REJECT', 'It drops the empty case.')] });
  assert.equal(split.outcome, 'DEADLOCK');

  const thin = rules.verdict({ receipts: [BUILDER, receipt('scrutator', 'anthropic', 'verify', 'APPROVE', GOOD)] });
  assert.equal(thin.outcome, 'NOT_PANEL', 'one vote is not a panel');
});

test('an approval with nothing behind it is an abstention', () => {
  const v = rules.verdict({ receipts: [BUILDER,
    receipt('scrutator', 'anthropic', 'verify', 'APPROVE', GOOD),
    receipt('advocatus', 'google', 'review', 'APPROVE', 'looks good to me')] });
  assert.deepEqual([v.approve, v.abstain], [1, 1]);
  assert.equal(v.outcome, 'DEADLOCK', 'one reasoned approval does not carry it');
  assert.equal(v.adjustments.length, 1);
  assert.equal(v.adjustments[0].counted, 'ABSTAIN');
  assert.ok(v.flags.includes('approve-without-evidence-counted-as-abstain'));
});

test('a rejection stands whatever its reason', () => {
  const v = rules.verdict({ receipts: [BUILDER,
    receipt('scrutator', 'anthropic', 'verify', 'REJECT', 'no'),
    receipt('advocatus', 'google', 'review', 'REJECT', 'nope')] });
  assert.equal(v.outcome, 'REJECT', 'a checker that objects has refused, reason or not');
});

test('one seat is one vote and one session is one vote', () => {
  const twice = rules.verdict({ receipts: [BUILDER,
    receipt('scrutator', 'anthropic', 'verify', 'APPROVE', GOOD),
    receipt('scrutator', 'anthropic', 'verify', 'APPROVE', GOOD),
    receipt('advocatus', 'google', 'review', 'APPROVE', 'I read the callers in app.py and none passes a tuple.')] });
  assert.equal(twice.approve, 2, 'the repeat is not a third vote');
  assert.match(twice.uncounted[0].reason, /second answer from the same seat/);

  const shared = rules.verdict({ receipts: [BUILDER,
    receipt('scrutator', 'anthropic', 'verify', 'APPROVE', GOOD, { sessionId: 'one' }),
    receipt('advocatus', 'google', 'review', 'APPROVE', 'I read the callers in app.py.', { sessionId: 'one' })] });
  assert.match(shared.uncounted[0].reason, /shared its vendor session/);
});

test('a critical unit needs three counted votes', () => {
  const receipts = [BUILDER,
    receipt('scrutator', 'anthropic', 'verify', 'APPROVE', GOOD),
    receipt('advocatus', 'google', 'review', 'APPROVE', 'I read the callers in app.py and none passes a tuple.')];
  assert.equal(rules.verdict({ receipts }).outcome, 'PASSAGE');
  assert.equal(rules.verdict({ receipts, critical: true }).outcome, 'NOT_PANEL', 'two is short of the critical quorum');
});

test('a failing check stops a landing whatever the seats voted', () => {
  const receipts = [BUILDER,
    receipt('scrutator', 'anthropic', 'verify', 'APPROVE', GOOD),
    receipt('advocatus', 'google', 'review', 'APPROVE', 'I read the callers in app.py and none passes a tuple.')];
  assert.equal(rules.verdict({ receipts, checkPassed: true }).outcome, 'PASSAGE');
  assert.equal(rules.verdict({ receipts, checkPassed: null }).outcome, 'PASSAGE', 'a unit with no check is judged by its seats');

  const red = rules.verdict({ receipts, checkPassed: false });
  assert.equal(red.outcome, 'CHECK_FAILED');
  assert.equal(red.lands, false);
  assert.equal(red.approve, 2, 'the approvals are still counted and still reported');
  assert.ok(red.flags.includes('the-unit-s-own-check-did-not-pass'));

  // The gate only ever takes passage away.
  const rejecting = [BUILDER,
    receipt('scrutator', 'anthropic', 'verify', 'REJECT', 'Step 3 is missing.'),
    receipt('advocatus', 'google', 'review', 'REJECT', 'The caller breaks.')];
  assert.equal(rules.verdict({ receipts: rejecting, checkPassed: false }).outcome, 'REJECT');
});

test('the verdict says how independent the checks actually were', () => {
  const same = (vendor) => [receipt('ponens', vendor, 'implement', null, null),
    receipt('scrutator', vendor, 'verify', 'APPROVE', GOOD),
    receipt('advocatus', vendor, 'review', 'APPROVE', 'I read the callers in app.py and none passes a tuple.')];
  assert.equal(rules.verdict({ receipts: same('anthropic') }).independence, 'singleVendor');
  assert.ok(rules.verdict({ receipts: same('anthropic') }).flags.includes('the-whole-panel-ran-on-one-vendor'));

  const crossed = [BUILDER,
    receipt('scrutator', 'anthropic', 'verify', 'APPROVE', GOOD),
    receipt('advocatus', 'google', 'review', 'APPROVE', 'I read the callers in app.py and none passes a tuple.')];
  assert.equal(rules.verdict({ receipts: crossed }).independence, 'crossVendor');

  const builderChecks = [BUILDER,
    receipt('scrutator', 'openai', 'verify', 'APPROVE', GOOD),
    receipt('advocatus', 'google', 'review', 'APPROVE', 'I read the callers in app.py and none passes a tuple.')];
  assert.equal(rules.verdict({ receipts: builderChecks }).independence, 'checkerSharesBuilder');
  assert.equal(rules.verdict({ receipts: [] }).independence, 'none', 'no checks, nothing to describe');
});

test('two approvals resting on one sentence are flagged as one argument', () => {
  const line = 'I ran the six tests in stats_test.py and they all pass.';
  const v = rules.verdict({ receipts: [BUILDER,
    receipt('scrutator', 'anthropic', 'verify', 'APPROVE', line),
    receipt('advocatus', 'google', 'review', 'APPROVE', line)] });
  assert.ok(v.flags.includes('both-checkers-gave-the-same-reason'));
  assert.equal(v.outcome, 'PASSAGE', 'flagged, not refused');
});

// The arbiter gates, or it votes, never both. Considered and rejected 2026-09-18 after the
// first live run returned a Jev verdict that contradicted its own score inside one output.
// This is a prohibition, so it is a test and not a comment: a later change that quietly hands
// the arbiter a ballot fails here.
test('the arbiter cannot cast a vote, on any unit, critical or not', () => {
  const seat = (slot, role, vendor, sid) => ({
    role, slot, vendor, position: 'APPROVE', status: 'completed',
    evidence: 'Ran the suite from a clean checkout; every check passed and the diff touches only the two files the brief named.',
    sessionId: sid, tokens: 1000, modelObserved: `${vendor}-model`, treeBefore: 'a', treeAfter: 'a',
  });
  const checkers = [seat('scrutator', 'verify', 'openai', 's1'), seat('advocatus', 'review', 'google', 's2')];

  // verdict takes no arbiter parameter; anything passed under that name must be ignored.
  const withBallot = rules.verdict({
    receipts: checkers, critical: true, checkPassed: true,
    arbiter: { vendor: 'jev', position: 'APPROVE', evidence: 'The replies establish the artifact meets its brief.', seated: false },
  });
  const without = rules.verdict({ receipts: checkers, critical: true, checkPassed: true });
  assert.deepEqual(withBallot, without, 'an arbiter ballot changes nothing about the count');
  assert.equal(withBallot.approve, 2, 'only the two seats voted');

  // and an arbiter-shaped receipt in the receipts array is not a counted seat either
  const smuggled = rules.verdict({
    receipts: [...checkers, { ...seat('arbiter', 'arbiter', 'jev', 's3'), role: 'arbiter' }],
    critical: true, checkPassed: true,
  });
  assert.equal(smuggled.approve, 2, 'an arbiter role does not become a third approval');
});
