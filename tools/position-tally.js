#!/usr/bin/env node
// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

/**
 * MAGI POSITION tally (FIX-MATH-002).
 *
 * Enforces the documented MAGI passage arithmetic so the arbiter does not
 * hand-count panel ballots. Canonical sources in this repo:
 *   README.md, .cursor/skills/magi/SKILL.md, cursor-cli.md,
 *   agents/gemini-reviewer.md + agents/gemini-verifier.md (protocol 6 scope).
 * magi-mode SKILL lives at ~/.claude and is not vendored here.
 *
 * Passage: >=2 APPROVE among eligible electors.
 * ABSTAIN never counts toward passage.
 * Quorum floor (shared with CONCLAVE tally-panel): when fewer than 2
 * eligible electors cast a counted POSITION, verdict is NOT_PANEL with
 * degraded=true and reason quorumFloor — fail closed, not DEADLOCK.
 * Else DEADLOCK. There is no panel REJECTED verdict.
 *
 * Electors are the three vendors (anthropic / openai / google). The Grok
 * arbiter never votes. implementer / reviewer / verifier are gate roles
 * (protocol 9 typed findings), not POSITION electors — a ballot may carry
 * a gate role for audit only.
 *
 * Protocol 6 author-vendor recusal applies to POSITION only: that elector
 * is ineligible. Degraded duo is the cursor-cli Claude fail path only
 * (anthropic ineligible; Codex+Gemini remain). Idle Casper is an
 * activation failure, not a duo — this tool refuses to mark google
 * degraded.
 */

const fs = require('node:fs');
const path = require('node:path');

const ELECTORS = Object.freeze(['anthropic', 'openai', 'google']);
const POSITIONS = Object.freeze(['APPROVE', 'ABSTAIN', 'REJECT']);
const GATE_ROLES = Object.freeze([
  'implement',
  'review',
  'verify',
  'implementer',
  'reviewer',
  'verifier',
]);
const FORBIDDEN_ELECTORS = Object.freeze([
  'arbiter',
  'grok',
  'xai',
  'jev',
  'camerlengo',
  'camerlengo-8',
  'lead',
]);
const PASSAGE_THRESHOLD = 2;
const QUORUM_FLOOR = 2;
const DEGRADED_VENDOR = 'anthropic';
const VERDICT = Object.freeze({
  PASSAGE: 'PASSAGE',
  DEADLOCK: 'DEADLOCK',
  NOT_PANEL: 'NOT_PANEL',
});

class TallyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TallyError';
  }
}

function fail(reason, status = 2) {
  console.error(String(reason).replace(/[\r\n]+/g, ' '));
  process.exit(status);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizePosition(value) {
  if (typeof value !== 'string') {
    throw new TallyError('invalid position');
  }
  const position = value.trim().toUpperCase();
  if (!POSITIONS.includes(position)) {
    throw new TallyError(`invalid position: ${value}`);
  }
  return position;
}

function normalizeElector(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TallyError('invalid elector');
  }
  const elector = value.trim().toLowerCase();
  if (FORBIDDEN_ELECTORS.includes(elector)) {
    throw new TallyError(`illegal elector: ${elector} cannot cast a POSITION vote`);
  }
  if (!ELECTORS.includes(elector)) {
    throw new TallyError(`invalid elector: ${value}`);
  }
  return elector;
}

function normalizeRole(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new TallyError('invalid role');
  }
  const role = value.trim().toLowerCase();
  if (!GATE_ROLES.includes(role)) {
    throw new TallyError(`invalid role: ${value}`);
  }
  return role;
}

function normalizeBallot(raw) {
  if (!isObject(raw)) {
    throw new TallyError('ballot must be a JSON object');
  }
  const electorValue = raw.elector !== undefined ? raw.elector : raw.vendor;
  const elector = normalizeElector(electorValue);
  const position = normalizePosition(raw.position);
  const role = normalizeRole(raw.role !== undefined ? raw.role : raw.gateRole);
  return { elector, position, role };
}

function uniqueElectors(ballots) {
  const seen = new Set();
  for (const ballot of ballots) {
    if (seen.has(ballot.elector)) {
      throw new TallyError(`duplicate elector: ${ballot.elector}`);
    }
    seen.add(ballot.elector);
  }
}

function resolveEligible(options) {
  const ineligible = new Map();

  if (options.degradedVendor !== undefined && options.degradedVendor !== null && options.degradedVendor !== '') {
    const vendor = normalizeElector(options.degradedVendor);
    if (vendor !== DEGRADED_VENDOR) {
      throw new TallyError(
        `degraded duo is the cursor-cli Claude fail path only; cannot mark ${vendor} degraded (idle Casper is FAILED activation, not a duo)`
      );
    }
  }

  if (options.degraded === true || options.degradedVendor === DEGRADED_VENDOR) {
    ineligible.set(DEGRADED_VENDOR, 'degraded-claude');
  }

  if (options.authorVendor !== undefined && options.authorVendor !== null && options.authorVendor !== '') {
    const author = normalizeElector(options.authorVendor);
    if (!ineligible.has(author)) {
      ineligible.set(author, 'author-recusal');
    }
  }

  const eligible = ELECTORS.filter((elector) => !ineligible.has(elector));
  return { eligible, ineligible };
}

function tally(input) {
  const options = Array.isArray(input) ? { ballots: input } : input;
  if (!isObject(options)) {
    throw new TallyError('tally input must be an object or ballot array');
  }
  if (!Array.isArray(options.ballots)) {
    throw new TallyError('ballots must be an array');
  }

  const ballots = options.ballots.map(normalizeBallot);
  uniqueElectors(ballots);

  const { eligible, ineligible } = resolveEligible(options);
  const counted = [];
  const ignored = [];

  for (const ballot of ballots) {
    if (ineligible.has(ballot.elector)) {
      ignored.push({
        ...ballot,
        reason: ineligible.get(ballot.elector),
      });
      continue;
    }
    counted.push(ballot);
  }

  let approveCount = 0;
  let abstainCount = 0;
  let rejectCount = 0;
  for (const ballot of counted) {
    switch (ballot.position) {
      case 'APPROVE':
        approveCount += 1;
        break;
      case 'ABSTAIN':
        abstainCount += 1;
        break;
      case 'REJECT':
        rejectCount += 1;
        break;
      default: {
        const _exhaustive = ballot.position;
        throw new TallyError(`unhandled position: ${_exhaustive}`);
      }
    }
  }

  const missing = eligible.filter((elector) => !counted.some((ballot) => ballot.elector === elector));
  const duoDegraded = [...ineligible.values()].includes('degraded-claude');
  const quorumMet = counted.length >= QUORUM_FLOOR;
  const passed = quorumMet && approveCount >= PASSAGE_THRESHOLD;

  let verdict;
  let reason = null;
  let degraded = duoDegraded;
  if (!quorumMet) {
    // Shared CONCLAVE quorum floor: a seat-down panel is not a panel.
    // Destructive gates stay fail closed — never PASSAGE, never a false DEADLOCK.
    verdict = VERDICT.NOT_PANEL;
    degraded = true;
    reason = 'quorumFloor';
  } else if (passed) {
    verdict = VERDICT.PASSAGE;
    reason = duoDegraded ? 'degraded-claude' : null;
  } else {
    verdict = VERDICT.DEADLOCK;
    reason = duoDegraded ? 'degraded-claude' : null;
  }

  return {
    verdict,
    degraded,
    reason,
    threshold: PASSAGE_THRESHOLD,
    quorumFloor: QUORUM_FLOOR,
    approveCount,
    abstainCount,
    rejectCount,
    eligibleElectors: eligible,
    ineligible: [...ineligible.entries()].map(([elector, reason]) => ({ elector, reason })),
    missingElectors: missing,
    counted,
    ignored,
    passed,
  };
}

function takeValue(args, index) {
  if (index + 1 >= args.length) {
    throw new TallyError(`missing value for ${args[index]}`);
  }
  return args[index + 1];
}

function parseArgs(args) {
  const parsed = {
    ballotsText: undefined,
    inputFile: undefined,
    degraded: false,
    degradedVendor: undefined,
    authorVendor: undefined,
    json: false,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--degraded') {
      parsed.degraded = true;
      parsed.degradedVendor = DEGRADED_VENDOR;
    } else if (arg === '--ballots') {
      if (parsed.ballotsText !== undefined) throw new TallyError('duplicate --ballots');
      parsed.ballotsText = takeValue(args, i);
      i += 1;
    } else if (arg === '--file') {
      if (parsed.inputFile !== undefined) throw new TallyError('duplicate --file');
      parsed.inputFile = takeValue(args, i);
      i += 1;
    } else if (arg === '--author-vendor') {
      parsed.authorVendor = takeValue(args, i);
      i += 1;
    } else if (arg === '--degraded-vendor') {
      parsed.degradedVendor = takeValue(args, i);
      parsed.degraded = true;
      i += 1;
    } else {
      throw new TallyError(`unknown argument ${arg}`);
    }
  }

  return parsed;
}

function parseBallotsText(text) {
  const trimmed = String(text).trim();
  if (trimmed === '') {
    throw new TallyError('empty ballots input');
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return { ballots: parsed };
    if (isObject(parsed)) {
      if (Array.isArray(parsed.ballots)) return parsed;
      throw new TallyError('JSON object must include a ballots array');
    }
    throw new TallyError('ballots JSON must be an array or object');
  } catch (error) {
    if (error instanceof TallyError) throw error;
  }

  const ballots = [];
  for (const line of trimmed.split('\n')) {
    const row = line.trim();
    if (!row) continue;
    try {
      ballots.push(JSON.parse(row));
    } catch (error) {
      throw new TallyError(`invalid JSONL line: ${error.message}`);
    }
  }
  if (ballots.length === 0) {
    throw new TallyError('invalid JSON: not an array, object, or JSONL');
  }
  return { ballots };
}

function loadInput(parsed) {
  if (parsed.help) return { help: true };

  if ((parsed.ballotsText === undefined) === (parsed.inputFile === undefined)) {
    throw new TallyError('use exactly one of --ballots or --file');
  }

  let text = parsed.ballotsText;
  if (parsed.inputFile !== undefined) {
    try {
      text = fs.readFileSync(path.resolve(parsed.inputFile), 'utf8');
    } catch (error) {
      throw new TallyError(`cannot read input file: ${error.message}`);
    }
  }

  const loaded = parseBallotsText(text);
  return {
    ballots: loaded.ballots,
    degraded: parsed.degraded || loaded.degraded === true,
    degradedVendor: parsed.degradedVendor || loaded.degradedVendor,
    authorVendor: parsed.authorVendor || loaded.authorVendor,
    json: parsed.json,
  };
}

function formatText(result) {
  const ineligible = result.ineligible.map((row) => `${row.elector}:${row.reason}`).join(',') || '-';
  const missing = result.missingElectors.join(',') || '-';
  return [
    `verdict: ${result.verdict}`,
    `degraded: ${result.degraded}`,
    `reason: ${result.reason || '-'}`,
    `approve: ${result.approveCount}`,
    `abstain: ${result.abstainCount}`,
    `reject: ${result.rejectCount}`,
    `threshold: ${result.threshold}`,
    `quorumFloor: ${result.quorumFloor}`,
    `eligible: ${result.eligibleElectors.join(',')}`,
    `ineligible: ${ineligible}`,
    `missing: ${missing}`,
  ].join('\n');
}

function usage() {
  return [
    'Usage: node tools/position-tally.js --ballots \'<json>\' [--degraded] [--author-vendor <vendor>] [--json]',
    '       node tools/position-tally.js --file <path> [--degraded] [--author-vendor <vendor>] [--json]',
    '',
    'Passage: >=2 APPROVE among eligible electors. ABSTAIN never toward passage.',
    'Counted eligible ballots < 2 => NOT_PANEL degraded=true reason=quorumFloor. Else DEADLOCK.',
    'Electors: anthropic | openai | google. Arbiter cannot vote.',
    'Exit 0 PASSAGE, 1 DEADLOCK or NOT_PANEL (fail closed), 2 invalid input.',
  ].join('\n');
}

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
    if (parsed.help) {
      console.log(usage());
      return 0;
    }
    const input = loadInput(parsed);
    const result = tally(input);
    if (input.json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(formatText(result));
    }
    return result.passed ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message, 2);
  }
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  ELECTORS,
  POSITIONS,
  GATE_ROLES,
  FORBIDDEN_ELECTORS,
  PASSAGE_THRESHOLD,
  QUORUM_FLOOR,
  DEGRADED_VENDOR,
  VERDICT,
  TallyError,
  tally,
  parseArgs,
  parseBallotsText,
  loadInput,
  formatText,
  usage,
  main,
};
