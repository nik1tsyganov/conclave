#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

/**
 * CONCLAVE arbiter judgments as Jev (TypeSafe System One) requests.
 *
 * The chair stays a deterministic driver; Jev proposes, code gates. Each
 * judgment is one batched request. routing is mix-mode's routing.json
 * (keys: classes, decisionMatrix2026-09-16, conclaveConveneByClass2026-09-16).
 * capacityState is ~/.claude/docs/capacity-state.json passed in as data.
 *
 *   classifyTask({briefText, repoFacts, unitCount}, routing, opts)
 *   pickSeats(classId, routing, capacityState, {duo})        (no Jev call)
 *   conveneThirdFamily({classId, contestSignals, unitCount}, routing, opts)
 *   netBenefit({classId, unitCount, bestSingleVendor}, routing, opts)
 *   tallyPositions({replies:[{seat, position, independentEvidence}]}, opts)
 *
 * opts: {systemOne (injectable), provenancePath}. Gates: route 0.6,
 * route-flagged 0.4, margin 0.15 (decisionMatrix policy), convene 0.6.
 *
 * CLI: node tools/jev-arbiter.js classify --brief <file> --routing <routing.json>
 *        [--provenance <jsonl>] [--repo-facts <text>] [--units <n>]
 */

const fs = require('node:fs');
const client = require('./jev-client.js');

const DM_KEY = 'decisionMatrix2026-09-16';
const CONVENE_KEY = 'conclaveConveneByClass2026-09-16';
const CONVENE_GATE = 0.6;
const EVIDENCE_GATE = 0.6;
const ROLES = ['implement', 'verify', 'review'];
const POSITIONS = ['APPROVE', 'REJECT', 'ABSTAIN'];
const VERDICT_LEVELS = [
  'REJECT: taken together the replies establish that the artifact fails its brief',
  'DEADLOCK: the replies do not settle whether the artifact passes; they disagree or lack evidence',
  'APPROVE: taken together the replies establish that the artifact meets its brief',
];

// Capacity buckets a vendor:model draws on (capacity-state.json bucketIds).
// Fable has its own weekly allowance beside the all-models pool.
function bucketsFor(vendor, model) {
  if (vendor === 'claude') return [model === 'fable' ? 'claude-fable-weekly' : 'claude-all-models-weekly', 'claude-5h'];
  if (vendor === 'codex') return ['codex-chatgpt-subscription'];
  if (vendor === 'gemini') return ['gemini-google-ai-ultra'];
  return [];
}

function bucketStatus(capacityState, bucketId) {
  const bucket = (capacityState?.buckets || []).find((b) => (b.bucketId || b.id) === bucketId);
  return bucket ? bucket.status : 'unknown';
}

// Ledger rule: exhausted is never dispatched; unknown is unavailable for a
// known-separate bucket (fable), available for a shared pool.
function modelAvailable(vendor, model, capacityState) {
  return bucketsFor(vendor, model).every((id) => {
    const status = bucketStatus(capacityState, id);
    if (status === 'exhausted') return false;
    if (status === 'unknown' && id === 'claude-fable-weekly') return false;
    return true;
  });
}

function policy(routing) {
  const p = routing[DM_KEY]?.policy || {};
  return { route: p.route ?? 0.6, routeFlag: p.routeFlag ?? 0.4, margin: p.minMarginToFlip ?? 0.15 };
}

function classGate(p, thresholds) {
  if (p >= thresholds.route) return 'route';
  if (p >= thresholds.routeFlag) return 'route-flagged';
  return 'owner';
}

async function ask(opts, state, questions) {
  const call = opts.systemOne || client.systemOne;
  return call({ state, questions, provenancePath: opts.provenancePath });
}

async function classifyTask({ briefText, repoFacts = '', unitCount = null }, routing, opts = {}) {
  const criteria = Object.fromEntries(Object.entries(routing.classes).map(([id, c]) => [id, c.title]));
  const state = { brief: briefText, repoFacts, unitCount };
  const questions = {
    taskClass: {
      type: 'choice',
      instructions: 'Which routing class best describes the task in `brief`, given `repoFacts` and the number of independent work units in `unitCount`? Judge the work the brief asks for, not vocabulary it happens to use.',
      criteria,
    },
  };
  const result = await ask(opts, state, questions);
  if (!result.ok) return { ok: false, notRun: result.notRun, classId: null, gate: 'owner' };
  const answer = result.answers.taskClass;
  const p = answer.probabilities[answer.choice];
  return {
    ok: true,
    classId: answer.choice,
    p,
    confidence: answer.confidence,
    distribution: answer.probabilities,
    gate: classGate(p, policy(routing)),
    usage: result.usage,
  };
}

function pickSeats(classId, routing, capacityState, { duo = false } = {}) {
  const row = routing[DM_KEY]?.classes?.[classId];
  if (!row) throw new Error(`no decision-matrix row for class ${classId}`);
  const thresholds = policy(routing);
  const seats = {};
  for (const role of ROLES) {
    const ranked = Object.entries(row[role].distribution)
      .map(([key, p]) => {
        const [vendor, model] = key.split(/:(.*)/s);
        return { vendor, model, p };
      })
      .sort((a, b) => b.p - a.p);
    const available = ranked.filter((c) => (!duo || c.vendor !== 'gemini') && modelAvailable(c.vendor, c.model, capacityState));
    const skipped = ranked.filter((c) => !available.includes(c)).map((c) => `${c.vendor}:${c.model}`);
    const pick = available[0] || null;
    const lead = pick ? pick.p - (available[1]?.p ?? 0) : 0;
    const routes = pick && (pick.p >= thresholds.route || (pick.p >= thresholds.routeFlag && lead >= thresholds.margin));
    seats[role] = pick
      ? { vendor: pick.vendor, model: pick.model, p: pick.p, lead, gate: routes ? 'route' : 'flagged', skipped }
      : { vendor: null, model: null, p: 0, lead: 0, gate: 'owner', skipped };
  }
  seats.implement.effort = row.effort.top;
  return { classId, seats, thirdFamilyPrior: row.thirdFamily?.p ?? null };
}

async function conveneThirdFamily({ classId, contestSignals = [], unitCount = null }, routing, opts = {}) {
  const prior = routing[CONVENE_KEY]?.[classId] ?? null;
  const state = { classId, classTitle: routing.classes[classId]?.title, prior, contestSignals, unitCount };
  const questions = {
    convene: {
      type: 'noul',
      instructions: 'Should the third vendor family (Gemini) convene as a third seat on this task, instead of the duo? `prior` is the base rate for this class from the decision matrix; `contestSignals` lists what the lead observed (contested gate, security surface, tie-break request, seat disagreement); `unitCount` is the number of independent units.',
      criteria: {
        true: 'A third decorrelated seat is worth its quota cost: genuine contest, security-sensitive change, tie-break, or a risk the duo cannot settle.',
        false: 'The duo settles this task; a third seat would add cost without changing the outcome.',
      },
    },
  };
  const result = await ask(opts, state, questions);
  if (!result.ok) return { ok: false, notRun: result.notRun, prior, convene: false };
  const p = result.answers.convene.noul;
  return { ok: true, p, prior, convene: p >= CONVENE_GATE, usage: result.usage };
}

async function netBenefit({ classId, unitCount = null, bestSingleVendor }, routing, opts = {}) {
  const state = { classId, classTitle: routing.classes[classId]?.title, unitCount, bestSingleVendor };
  const questions = {
    netBenefit: {
      type: 'noul',
      instructions: 'Would a multi-vendor panel produce a better result on this task than `bestSingleVendor` working alone? A panel costs every seat its own quota plus the lead\'s tokens; it must beat the best solo vendor, not merely add opinions.',
      criteria: {
        true: 'The panel is likely to catch errors or improve the output beyond what the best single vendor would deliver.',
        false: 'The best single vendor alone would deliver an equal or better result.',
      },
    },
  };
  const result = await ask(opts, state, questions);
  if (!result.ok) return { ok: false, notRun: result.notRun, convene: false };
  const p = result.answers.netBenefit.noul;
  return { ok: true, p, convene: p >= CONVENE_GATE, usage: result.usage };
}

// Deliberation protocol 1, 5, 6: independent replies; agreement costs
// evidence (an APPROVE without independent evidence counts as ABSTAIN);
// quorum floor of two eligible seats; passage needs two APPROVE, two REJECT
// rejects, anything else is DEADLOCK. Recusal is declared by the lead before
// dispatch, so a recused seat never appears in replies.
async function tallyPositions({ replies }, opts = {}) {
  const eligible = replies.filter((r) => POSITIONS.includes(r.position));
  const invalid = replies.filter((r) => !POSITIONS.includes(r.position)).map((r) => r.seat);
  if (eligible.length < 2) {
    return { verdict: 'NOT_PANEL', degraded: true, reason: 'quorumFloor', eligible: eligible.length, invalid, replies: [] };
  }

  const state = { replies: eligible.map((r) => ({ seat: r.seat, position: r.position, independentEvidence: r.independentEvidence || '', text: r.text || '' })) };
  const questions = {
    verdict: {
      type: 'score',
      instructions: 'Read every reply in `replies` (anonymised seats A/B/C). Where does the panel as a whole land on the artifact under review?',
      criteria: VERDICT_LEVELS,
    },
  };
  for (const r of eligible) {
    questions[`evidence_${r.seat}`] = {
      type: 'noul',
      instructions: `Does the reply from seat ${r.seat} carry independent evidence not present in the reviewed text: a reason, check, or observation of its own rather than a restatement of the artifact or of another reply? Read its \`independentEvidence\` field and its \`text\`.`,
      criteria: {
        true: 'The reply contributes at least one independent reason or check of its own.',
        false: 'The reply restates the artifact, agrees without a reason, or its independent-evidence field is empty or generic.',
      },
    };
  }
  const unanimous = eligible.every((r) => r.position === eligible[0].position);
  if (unanimous) {
    questions.overlappingReasoning = {
      type: 'noul',
      instructions: 'The replies agree unanimously. Is their reasoning overlapping, so that they would collapse into one argument if merged?',
      criteria: { true: 'The replies give the same reasons in different words.', false: 'The replies reach the same position from distinct reasons or checks.' },
    };
  }

  const result = await ask(opts, state, questions);
  const counted = eligible.map((r) => {
    const evidenceP = result.ok ? result.answers[`evidence_${r.seat}`].noul : null;
    const hasEvidence = result.ok ? evidenceP >= EVIDENCE_GATE : Boolean(r.independentEvidence && r.independentEvidence.trim());
    const position = r.position === 'APPROVE' && !hasEvidence ? 'ABSTAIN' : r.position;
    return { seat: r.seat, declared: r.position, counted: position, evidenceP, downgraded: position !== r.position };
  });
  const counts = Object.fromEntries(POSITIONS.map((p) => [p, counted.filter((c) => c.counted === p).length]));
  const verdict = counts.APPROVE >= 2 ? 'PASSAGE' : counts.REJECT >= 2 ? 'REJECT' : 'DEADLOCK';

  const out = { verdict, degraded: false, counts, replies: counted, invalid, flags: [] };
  if (counted.some((c) => c.downgraded)) out.flags.push('approve-without-evidence-counted-as-abstain');
  if (result.ok) {
    const score = result.answers.verdict;
    out.jev = { score: score.score, legend: score.legend, probabilities: score.probabilities, confidence: score.confidence };
    // Jev returns the legend as an object keyed by level; compare the level nearest the score.
    const nearest = score.legend && typeof score.legend === 'object' ? String(score.legend[String(Math.round(Number(score.score)))] || '') : String(score.legend || '');
    if (nearest && !nearest.startsWith(verdict === 'PASSAGE' ? 'APPROVE' : verdict)) out.flags.push('jev-score-disagrees-with-tally');
    if (unanimous && result.answers.overlappingReasoning.noul >= EVIDENCE_GATE) out.flags.push('suspiciously-clean-consensus');
    out.usage = result.usage;
  } else {
    out.notRun = result.notRun;
    out.flags.push('evidence-check-deterministic-only');
  }
  return out;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i += 1; }
  }
  return args;
}

async function main(argv) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  if (command !== 'classify' || !args.brief || !args.routing) {
    console.error('usage: node tools/jev-arbiter.js classify --brief <file> --routing <routing.json> [--provenance <jsonl>] [--repo-facts <text>] [--units <n>]');
    process.exit(2);
  }
  const routing = JSON.parse(fs.readFileSync(args.routing, 'utf8'));
  const result = await classifyTask(
    { briefText: fs.readFileSync(args.brief, 'utf8'), repoFacts: args['repo-facts'] || '', unitCount: args.units ? Number(args.units) : null },
    routing,
    { provenancePath: args.provenance },
  );
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

module.exports = { classifyTask, pickSeats, conveneThirdFamily, netBenefit, tallyPositions, modelAvailable, bucketsFor, VERDICT_LEVELS };

if (require.main === module) main(process.argv.slice(2));
