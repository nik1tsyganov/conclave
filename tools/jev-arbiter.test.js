// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { classifyTask, pickSeats, conveneThirdFamily, netBenefit, tallyPositions, modelAvailable } = require('./jev-arbiter.js');

const CLASS_IDS = ['planning', 'standard-feature', 'hard-risky', 'security-sensitive', 'bulk-mechanical', 'parallel-slices', 'debug-mystery', 'tie-break', 'long-context-analysis', 'research-synthesis', 'prose-writing', 'ui-design', 'tutoring-dispatch', 'research-swarm'];

function dist(entries) {
  return Object.fromEntries(entries);
}

// A routing.json subset shaped like mix-mode's (classes, decisionMatrix2026-09-16, conclaveConveneByClass2026-09-16).
const ROUTING = {
  classes: Object.fromEntries(CLASS_IDS.map((id) => [id, { title: `Title of ${id}` }])),
  'decisionMatrix2026-09-16': {
    policy: { route: 0.6, routeFlag: 0.4, minMarginToFlip: 0.15 },
    classes: {
      'hard-risky': {
        implement: { distribution: dist([['claude:opus', 0.94], ['codex:gpt-6-astra', 0.04], ['gemini:gemini-3.1-pro-high', 0.01], ['claude:fable', 0.01]]) },
        verify: { distribution: dist([['codex:gpt-6-astra', 0.89], ['codex:gpt-5.5', 0.05], ['gemini:gemini-3.1-pro-high', 0.04], ['claude:opus', 0.02]]) },
        review: { distribution: dist([['codex:gpt-6-astra', 0.46], ['gemini:gemini-3.1-pro-high', 0.38], ['codex:gpt-5.5', 0.07], ['claude:opus', 0.05]]) },
        effort: { top: 'xhigh' },
        thirdFamily: { p: 0.68 },
      },
      planning: {
        implement: { distribution: dist([['claude:fable', 0.78], ['claude:opus', 0.12], ['codex:gpt-6-astra', 0.08]]) },
        verify: { distribution: dist([['codex:gpt-6-astra', 0.89], ['claude:sonnet', 0.03]]) },
        review: { distribution: dist([['codex:gpt-6-astra', 0.53], ['gemini:gemini-3.1-pro-high', 0.18], ['claude:sonnet', 0.09]]) },
        effort: { top: 'high' },
        thirdFamily: { p: 0.25 },
      },
      'standard-feature': {
        implement: { distribution: dist([['codex:gpt-5.6-sol', 0.42], ['claude:sonnet', 0.35], ['claude:opus', 0.2]]) },
        verify: { distribution: dist([['claude:sonnet', 0.59], ['codex:gpt-6-astra', 0.3]]) },
        review: { distribution: dist([['codex:gpt-6-astra', 0.53], ['claude:sonnet', 0.3]]) },
        effort: { top: 'medium' },
        thirdFamily: { p: 0.32 },
      },
    },
  },
  'conclaveConveneByClass2026-09-16': { 'hard-risky': 0.68, planning: 0.25, 'standard-feature': 0.32 },
};

function ledger(statusById) {
  const ids = ['claude-all-models-weekly', 'claude-fable-weekly', 'claude-5h', 'codex-chatgpt-subscription', 'gemini-google-ai-ultra'];
  return { buckets: ids.map((bucketId) => ({ bucketId, vendor: bucketId.split('-')[0], status: statusById[bucketId] || 'available' })) };
}

// Fake systemOne: records the request, answers from a script keyed by question id.
function fake(answersFor, log = []) {
  return { log, systemOne: async (req) => { log.push(req); return { ok: true, answers: answersFor(req.questions), usage: { input_tokens: 1, output_tokens: 1 } }; } };
}
const NOT_RUN = { systemOne: async () => ({ ok: false, notRun: 'TYPESAFE_API_KEY not set', answers: {}, usage: null }) };

function choice(top, p) {
  const probabilities = Object.fromEntries(CLASS_IDS.map((id) => [id, 0]));
  probabilities[top] = p;
  probabilities[top === 'planning' ? 'hard-risky' : 'planning'] = Number((1 - p).toFixed(2));
  return { taskClass: { choice: top, probabilities, confidence: p } };
}

describe('classifyTask', () => {
  it('asks one Choice over the 14 class ids with titles as criteria and routes at p>=0.6', async () => {
    const f = fake(() => choice('standard-feature', 0.72));
    const r = await classifyTask({ briefText: 'fix three bugs', repoFacts: 'node repo', unitCount: 3 }, ROUTING, f);
    assert.strictEqual(f.log.length, 1);
    const q = f.log[0].questions.taskClass;
    assert.strictEqual(q.type, 'choice');
    assert.deepStrictEqual(Object.keys(q.criteria).sort(), [...CLASS_IDS].sort());
    assert.strictEqual(q.criteria.planning, 'Title of planning');
    assert.deepStrictEqual(f.log[0].state, { brief: 'fix three bugs', repoFacts: 'node repo', unitCount: 3 });
    assert.strictEqual(r.classId, 'standard-feature');
    assert.strictEqual(r.p, 0.72);
    assert.strictEqual(r.gate, 'route');
    assert.strictEqual(Object.keys(r.distribution).length, 14);
  });

  it('gates route-flagged in [0.4,0.6) and owner below 0.4', async () => {
    assert.strictEqual((await classifyTask({ briefText: 'x' }, ROUTING, fake(() => choice('planning', 0.5)))).gate, 'route-flagged');
    assert.strictEqual((await classifyTask({ briefText: 'x' }, ROUTING, fake(() => choice('planning', 0.6)))).gate, 'route');
    assert.strictEqual((await classifyTask({ briefText: 'x' }, ROUTING, fake(() => choice('planning', 0.39)))).gate, 'owner');
  });

  it('returns NOT_RUN with gate owner when the key is absent', async () => {
    const r = await classifyTask({ briefText: 'x' }, ROUTING, NOT_RUN);
    assert.deepStrictEqual(r, { ok: false, notRun: 'TYPESAFE_API_KEY not set', classId: null, gate: 'owner' });
  });
});

describe('pickSeats', () => {
  it('takes the argmax per role, carries effort and the third-family prior', () => {
    const r = pickSeats('hard-risky', ROUTING, ledger({}));
    assert.deepStrictEqual({ vendor: r.seats.implement.vendor, model: r.seats.implement.model, gate: r.seats.implement.gate, effort: r.seats.implement.effort }, { vendor: 'claude', model: 'opus', gate: 'route', effort: 'xhigh' });
    assert.strictEqual(r.seats.verify.model, 'gpt-6-astra');
    assert.strictEqual(r.seats.verify.gate, 'route');
    assert.strictEqual(r.thirdFamilyPrior, 0.68);
  });

  it('applies the margin rule: p>=0.4 needs a 0.15 lead, else flagged', () => {
    const r = pickSeats('hard-risky', ROUTING, ledger({}));
    assert.strictEqual(r.seats.review.model, 'gpt-6-astra');
    assert.strictEqual(r.seats.review.gate, 'flagged');
    const s = pickSeats('standard-feature', ROUTING, ledger({}));
    assert.strictEqual(s.seats.implement.gate, 'flagged');
    assert.strictEqual(s.seats.review.gate, 'route');
  });

  it('never returns a model whose bucket is exhausted and records what it skipped', () => {
    const r = pickSeats('hard-risky', ROUTING, ledger({ 'codex-chatgpt-subscription': 'exhausted' }), { duo: true });
    assert.deepStrictEqual([r.seats.verify.vendor, r.seats.verify.model], ['claude', 'opus']);
    assert.deepStrictEqual(r.seats.verify.skipped, ['codex:gpt-6-astra', 'codex:gpt-5.5', 'gemini:gemini-3.1-pro-high']);
    assert.strictEqual(r.seats.verify.gate, 'flagged');
    for (const classId of Object.keys(ROUTING['decisionMatrix2026-09-16'].classes)) {
      const picked = pickSeats(classId, ROUTING, ledger({ 'codex-chatgpt-subscription': 'exhausted' }));
      for (const role of ['implement', 'verify', 'review']) assert.notStrictEqual(picked.seats[role].vendor, 'codex', `${classId}/${role}`);
    }
  });

  it('treats the fable bucket separately: exhausted or unknown blocks fable only', () => {
    assert.strictEqual(pickSeats('planning', ROUTING, ledger({ 'claude-fable-weekly': 'exhausted' })).seats.implement.model, 'opus');
    assert.strictEqual(pickSeats('planning', ROUTING, ledger({ 'claude-fable-weekly': 'unknown' })).seats.implement.model, 'opus');
    assert.strictEqual(pickSeats('planning', ROUTING, ledger({ 'claude-all-models-weekly': 'unknown' })).seats.implement.model, 'fable');
    assert.strictEqual(pickSeats('planning', ROUTING, ledger({ 'claude-5h': 'exhausted' })).seats.implement.vendor, 'codex');
    assert.strictEqual(modelAvailable('claude', 'fable', { buckets: [] }), false);
    assert.strictEqual(modelAvailable('claude', 'opus', { buckets: [] }), true);
  });

  it('surfaces to the owner when every candidate is exhausted', () => {
    const r = pickSeats('planning', ROUTING, ledger({ 'claude-5h': 'exhausted', 'codex-chatgpt-subscription': 'exhausted', 'gemini-google-ai-ultra': 'exhausted' }));
    assert.deepStrictEqual(r.seats.implement, { vendor: null, model: null, p: 0, lead: 0, gate: 'owner', skipped: ['claude:fable', 'claude:opus', 'codex:gpt-6-astra'], effort: 'high' });
  });

  it('rejects an unknown class', () => {
    assert.throws(() => pickSeats('nope', ROUTING, ledger({})), /no decision-matrix row/);
  });
});

describe('conveneThirdFamily and netBenefit', () => {
  it('puts the class prior in the state and gates at 0.6', async () => {
    const f = fake(() => ({ convene: { noul: 0.71 } }));
    const r = await conveneThirdFamily({ classId: 'hard-risky', contestSignals: ['contested gate'], unitCount: 2 }, ROUTING, f);
    assert.strictEqual(f.log[0].state.prior, 0.68);
    assert.strictEqual(f.log[0].state.classTitle, 'Title of hard-risky');
    assert.strictEqual(f.log[0].questions.convene.type, 'noul');
    assert.deepStrictEqual({ p: r.p, prior: r.prior, convene: r.convene }, { p: 0.71, prior: 0.68, convene: true });
    const low = await conveneThirdFamily({ classId: 'planning' }, ROUTING, fake(() => ({ convene: { noul: 0.59 } })));
    assert.strictEqual(low.convene, false);
    const off = await conveneThirdFamily({ classId: 'planning' }, ROUTING, NOT_RUN);
    assert.deepStrictEqual(off, { ok: false, notRun: 'TYPESAFE_API_KEY not set', prior: 0.25, convene: false });
  });

  it('netBenefit gates at 0.6 and names the best single vendor in the state', async () => {
    const f = fake(() => ({ netBenefit: { noul: 0.6 } }));
    const r = await netBenefit({ classId: 'standard-feature', unitCount: 3, bestSingleVendor: 'codex:gpt-5.6-sol' }, ROUTING, f);
    assert.strictEqual(f.log[0].state.bestSingleVendor, 'codex:gpt-5.6-sol');
    assert.strictEqual(r.convene, true);
    assert.strictEqual((await netBenefit({ classId: 'standard-feature', bestSingleVendor: 'x' }, ROUTING, fake(() => ({ netBenefit: { noul: 0.42 } })))).convene, false);
  });
});

describe('tallyPositions', () => {
  const evidence = (map) => (questions) => {
    const answers = { verdict: { score: 1.8, legend: map.legend || 'APPROVE: taken together the replies establish that the artifact meets its brief', probabilities: { 0: 0.1, 1: 0.1, 2: 0.8 }, confidence: 0.7 } };
    for (const id of Object.keys(questions)) {
      if (id.startsWith('evidence_')) answers[id] = { noul: map[id.slice('evidence_'.length)] };
      if (id === 'overlappingReasoning') answers[id] = { noul: map.overlap ?? 0.1 };
    }
    return answers;
  };

  it('fails closed on the quorum floor without calling Jev', async () => {
    const f = fake(() => ({}));
    const r = await tallyPositions({ replies: [{ seat: 'A', position: 'APPROVE', independentEvidence: 'ran the tests' }] }, f);
    assert.strictEqual(r.verdict, 'NOT_PANEL');
    assert.strictEqual(r.degraded, true);
    assert.strictEqual(r.reason, 'quorumFloor');
    assert.strictEqual(f.log.length, 0);
    const bad = await tallyPositions({ replies: [{ seat: 'A', position: 'APPROVE' }, { seat: 'B', position: 'maybe' }] }, f);
    assert.deepStrictEqual([bad.verdict, bad.invalid], ['NOT_PANEL', ['B']]);
  });

  it('asks one Score plus one evidence Noul per reply, and passes on two evidenced APPROVEs', async () => {
    const f = fake(evidence({ A: 0.9, B: 0.8, C: 0.7 }));
    const r = await tallyPositions({ replies: [
      { seat: 'A', position: 'APPROVE', independentEvidence: 'ran npm test: 3 pass' },
      { seat: 'B', position: 'APPROVE', independentEvidence: 'checked clamp lower bound by hand' },
      { seat: 'C', position: 'REJECT', independentEvidence: 'sum([]) not covered' },
    ] }, f);
    const q = f.log[0].questions;
    assert.strictEqual(q.verdict.type, 'score');
    assert.strictEqual(q.verdict.criteria.length, 3);
    assert.deepStrictEqual(Object.keys(q).filter((k) => k.startsWith('evidence_')), ['evidence_A', 'evidence_B', 'evidence_C']);
    assert.strictEqual(q.overlappingReasoning, undefined);
    assert.strictEqual(r.verdict, 'PASSAGE');
    assert.deepStrictEqual(r.counts, { APPROVE: 2, REJECT: 1, ABSTAIN: 0 });
    assert.strictEqual(r.jev.score, 1.8);
    assert.deepStrictEqual(r.flags, []);
  });

  it('an APPROVE without independent evidence counts as ABSTAIN, so A/A/R becomes DEADLOCK', async () => {
    const f = fake(evidence({ A: 0.9, B: 0.2, C: 0.9, legend: 'DEADLOCK: the replies do not settle whether the artifact passes; they disagree or lack evidence' }));
    const r = await tallyPositions({ replies: [
      { seat: 'A', position: 'APPROVE', independentEvidence: 'ran tests' },
      { seat: 'B', position: 'APPROVE', independentEvidence: 'looks good' },
      { seat: 'C', position: 'REJECT', independentEvidence: 'edge case' },
    ] }, f);
    assert.strictEqual(r.verdict, 'DEADLOCK');
    assert.deepStrictEqual(r.replies.find((x) => x.seat === 'B'), { seat: 'B', declared: 'APPROVE', counted: 'ABSTAIN', evidenceP: 0.2, downgraded: true });
    assert.deepStrictEqual(r.flags, ['approve-without-evidence-counted-as-abstain']);
  });

  it('two REJECTs reject; A/R/ABSTAIN deadlocks; a REJECT never needs the evidence noul to count', async () => {
    const two = await tallyPositions({ replies: [{ seat: 'A', position: 'REJECT' }, { seat: 'B', position: 'REJECT' }, { seat: 'C', position: 'APPROVE', independentEvidence: 'x' }] }, fake(evidence({ A: 0.1, B: 0.1, C: 0.9, legend: 'REJECT: no' })));
    assert.strictEqual(two.verdict, 'REJECT');
    const split = await tallyPositions({ replies: [{ seat: 'A', position: 'APPROVE', independentEvidence: 'x' }, { seat: 'B', position: 'REJECT' }, { seat: 'C', position: 'ABSTAIN' }] }, fake(evidence({ A: 0.9, B: 0.9, C: 0.5, legend: 'DEADLOCK: x' })));
    assert.strictEqual(split.verdict, 'DEADLOCK');
  });

  it('flags a unanimous panel with overlapping reasoning and a Jev score that disagrees with the tally', async () => {
    const f = fake(evidence({ A: 0.9, B: 0.9, overlap: 0.8, legend: 'DEADLOCK: the replies do not settle it' }));
    const r = await tallyPositions({ replies: [{ seat: 'A', position: 'APPROVE', independentEvidence: 'x' }, { seat: 'B', position: 'APPROVE', independentEvidence: 'y' }] }, f);
    assert.strictEqual(f.log[0].questions.overlappingReasoning.type, 'noul');
    assert.strictEqual(r.verdict, 'PASSAGE');
    assert.deepStrictEqual(r.flags.sort(), ['jev-score-disagrees-with-tally', 'suspiciously-clean-consensus']);
  });

  it('without the key the tally still runs on the deterministic evidence-field check', async () => {
    const r = await tallyPositions({ replies: [
      { seat: 'A', position: 'APPROVE', independentEvidence: 'ran tests' },
      { seat: 'B', position: 'APPROVE', independentEvidence: '   ' },
    ] }, NOT_RUN);
    assert.strictEqual(r.verdict, 'DEADLOCK');
    assert.strictEqual(r.notRun, 'TYPESAFE_API_KEY not set');
    assert.strictEqual(r.jev, undefined);
    assert.deepStrictEqual(r.flags, ['approve-without-evidence-counted-as-abstain', 'evidence-check-deterministic-only']);
  });
});
