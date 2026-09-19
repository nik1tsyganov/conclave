#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

// The panel's rules, as a service a host can call.
//
// A host that wants a panel in its own interface needs two things from us and nothing else:
// who should build and who should check, and what the replies add up to. Everything around
// that — spawning a session, copying a checkout, applying a patch, drawing a card — is the
// host's own plumbing and is worth nothing to anybody else.
//
// Keeping the rules here rather than in each host is not about secrecy. It is that a rule
// implemented twice is two rules. This runtime and Droppy Code's panel already drifted once
// on something as small as a list of legal host modes, in one repository; across two
// languages and two repositories it would be constant.
//
// Everything here is pure: no filesystem, no network, no clock. The same input gives the same
// answer on any machine, which is what lets a host cache it and what lets a disagreement
// between a host and this file be settled by rerunning it.

const POSITIONS = Object.freeze(['APPROVE', 'REJECT', 'ABSTAIN']);
const ROLES = Object.freeze(['implement', 'verify', 'review']);
/// The only roles that produce a counted vote. The builder's tree moved; nothing else is a seat.
const COUNTING_ROLES = Object.freeze(['verify', 'review']);

/// Two counted checks carry an ordinary unit. A critical one needs its verifier and both of
/// its reviews, which is what the extra seat is for.
const ORDINARY_QUORUM = 2;
const CRITICAL_QUORUM = 3;

/// Under this an evidence line is an acknowledgement rather than an observation.
const MIN_EVIDENCE_CHARS = 24;
const MIN_EVIDENCE_WORDS = 4;

/// Phrases that are agreement and nothing else, matched against the whole line, so a reply
/// that opens with one and then says something is untouched.
const AGREEMENT_ONLY = new Set([
  'looks good', 'looks good to me', 'lgtm', 'i agree', 'agreed', 'approved', 'approve',
  'no issues', 'no issues found', 'no problems', 'nothing to add', 'all good', 'fine',
  'seems correct', 'looks correct', 'as described', 'matches the brief', 'ok', 'okay',
  'no concerns', 'works', 'it works', 'done', 'correct', 'confirmed',
]);

/// Words that carry no evidence on their own, for the word count.
const FILLER = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'is', 'are', 'was',
  'were', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'we', 'my', 'our', 'be',
  'been', 'as', 'so', 'for', 'with', 'by', 'from', 'all', 'any', 'not', 'no', 'yes',
]);

/// A line reduced to its words, lowercased, with every run of anything else collapsed to one
/// space. Agreement wears whatever punctuation the model felt like: "Looks good!",
/// "Approved." and "LGTM -- nice one" are one sentence, and a test against the raw line
/// misses all three.
function plainWords(line) {
  let out = '';
  let pendingSpace = false;
  for (const character of line.toLowerCase()) {
    if (/[\p{L}\p{N}]/u.test(character)) {
      if (pendingSpace && out.length > 0) out += ' ';
      pendingSpace = false;
      out += character;
    } else if (out.length > 0) {
      pendingSpace = true;
    }
  }
  return out;
}

/// Whether a line points at something a reader can go and look at: a path, a symbol in
/// backticks, a quoted fragment, a number or a file extension. Used for a flag on the
/// verdict, never to drop a vote.
function hasAnchor(evidence) {
  if (typeof evidence !== 'string') return false;
  if (evidence.includes('`') || evidence.includes('"') || evidence.includes('/')) return true;
  if (/\p{N}/u.test(evidence)) return true;
  return /\.[a-zA-Z]{1,6}\b/.test(evidence);
}

/// Whether a line reads as the checker's own observation rather than as agreement.
///
/// Deliberately blunt: it rejects what is plainly nothing and lets everything else through to
/// be read by a person. A reason with no file, symbol or number in it is still a reason, and
/// is flagged rather than thrown away.
function judgeEvidence(evidence) {
  if (typeof evidence !== 'string' || evidence.trim().length === 0) {
    return { independent: false, reason: 'gave no evidence line' };
  }
  const line = evidence.trim();
  const normalized = plainWords(line);
  if (AGREEMENT_ONLY.has(normalized)) return { independent: false, reason: 'agreed without a reason' };
  // Agreement with a few friendly words after it is still agreement. It is let through only
  // when it points at something: "looks good, the guard at line 42 returns first" is a
  // reason, "looks good to me, nice work" is not.
  if (!hasAnchor(line)) {
    for (const phrase of AGREEMENT_ONLY) {
      if (normalized === phrase || normalized.startsWith(`${phrase} `)) {
        return { independent: false, reason: 'agreed without a reason' };
      }
    }
  }
  if ([...line].length < MIN_EVIDENCE_CHARS) return { independent: false, reason: 'evidence was one phrase' };
  const words = new Set(normalized.split(' ').filter((word) => word.length > 0 && !FILLER.has(word)));
  if (words.size < MIN_EVIDENCE_WORDS) return { independent: false, reason: 'evidence was one phrase' };
  return { independent: true, reason: null };
}

/// The checker's declared position: exactly one POSITION line, on a line of its own, with
/// nothing after it but EVIDENCE lines.
///
/// Two POSITION lines are not a vote and neither is none, so a reply that hedges with both is
/// read as no answer. A reply that votes and then argues against its own vote has not
/// answered either: counting the line and ignoring the paragraph under it would record a
/// position nobody held.
function positionIn(text) {
  if (typeof text !== 'string') return null;
  const pattern = /^[ \t]*POSITION:[ \t]*(APPROVE|REJECT|ABSTAIN)[ \t]*$/gm;
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) return null;
  const tail = text.slice(matches[0].index + matches[0][0].length);
  for (const line of tail.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (!trimmed.startsWith('EVIDENCE:')) return null;
  }
  return matches[0][1];
}

/// The checker's own evidence: the last EVIDENCE line, since a reply that restates the
/// contract at the top and answers at the bottom means the bottom one.
function evidenceIn(text) {
  if (typeof text !== 'string') return null;
  const matches = [...text.matchAll(/^[ \t]*EVIDENCE:[ \t]*(.*)$/gm)];
  if (matches.length === 0) return null;
  const line = matches[matches.length - 1][1].trim();
  return line.length === 0 ? null : line;
}

/// Whether a seat's receipt is worth counting: it answered, it declared a position, it can
/// show which vendor session answered and what that cost, and it left the files alone.
///
/// A seat that cannot prove its session, its tokens and the model that actually answered is
/// not a reading anyone can check, whatever it said.
function receiptCounts(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  if (receipt.status !== 'completed') return false;
  if (receipt.voidReason) return false;
  const proof = typeof receipt.sessionId === 'string' && receipt.sessionId.trim().length > 0
    && Number.isFinite(receipt.tokens) && receipt.tokens > 0
    && typeof receipt.modelObserved === 'string' && receipt.modelObserved.trim().length > 0;
  if (!proof) return false;
  // Both trees or neither: a missing audit is a check that did not run, and a check that did
  // not run allows nothing.
  if (typeof receipt.treeBefore !== 'string' || typeof receipt.treeAfter !== 'string') return false;
  return receipt.treeBefore === receipt.treeAfter;
}

/// How independent the checks were, from the vendors behind the votes that were counted.
/// A reading of what happened rather than a rule: nothing here refuses a vote.
function independenceOf(receipts) {
  const checkers = new Set(receipts.filter((r) => r.role !== 'implement').map((r) => r.vendor));
  if (checkers.size === 0) return 'none';
  const builder = receipts.find((r) => r.role === 'implement');
  if (!builder) return checkers.size > 1 ? 'crossVendor' : 'checkersShareVendor';
  if (checkers.has(builder.vendor)) return checkers.size === 1 ? 'singleVendor' : 'checkerSharesBuilder';
  return checkers.size > 1 ? 'crossVendor' : 'checkersShareVendor';
}

/// Whether two approvals rest on the same sentence, which would make them one argument
/// counted twice.
function sameReason(receipts) {
  const lines = receipts.map((r) => plainWords(r.evidence || '')).filter((l) => l.length > 0);
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[i] === lines[j]) return true;
    }
  }
  return false;
}

/// Counts one unit's panel.
///
/// The builder's own receipt belongs in `receipts`: it never votes, and it is what says how
/// independent the checks were.
///
/// `checkPassed` is whether the unit's own check passed, or null when it named none. A check
/// that failed stops the work landing whatever the seats said. Measured on a live panel where
/// a brief contradicted the repository's test, both checkers read the failure, decided the
/// test was wrong, approved with reasons, and the work landed red. The votes were defensible.
/// The landing was not.
/// The arbiter is NOT a parameter here, and that is deliberate.
///
/// Considered and rejected 2026-09-18: letting the arbiter cast a critical unit's third vote.
/// It grades a panel it composed - it proposes the class, the seats and whether to convene -
/// which is the same conflict as a builder voting on its own work, one step removed. It also
/// never reads the artifact; it judges replies, so its ballot would claim a third look that
/// nobody took. Measured the same day: on the first live run Jev returned verdict DEADLOCK
/// with APPROVE 0 / ABSTAIN 2 while its own score said APPROVE at confidence 1, and flagged
/// the disagreement itself. A judge that contradicts itself inside one output does not get a
/// ballot. It gates, or it votes, never both.
function verdict({ receipts, critical = false, checkPassed = null } = {}) {
  if (!Array.isArray(receipts)) throw new TypeError('receipts must be an array');
  const uncounted = [];
  const adjustments = [];
  const flags = [];
  const counted = [];
  const seenSeats = new Set();
  const seenSessions = new Set();

  for (const receipt of receipts) {
    // An allowlist, not a denylist. Skipping only 'implement' meant any other role - an
    // arbiter ballot, a 'plan' or 'research' entry - became a counted approval simply by not
    // being the builder. Only the two checking roles produce a vote.
    if (!COUNTING_ROLES.includes(receipt.role)) continue;
    // One seat in one role is one vote, and one vendor session is one vote. The same reading
    // recorded twice would let a single opinion carry a unit on its own.
    const seat = `${receipt.role}:${receipt.slot}`;
    if (seenSeats.has(seat)) {
      uncounted.push({ slot: receipt.slot, role: receipt.role, reason: 'was a second answer from the same seat' });
      continue;
    }
    seenSeats.add(seat);
    const session = (receipt.sessionId || '').trim();
    if (session.length > 0 && seenSessions.has(session)) {
      uncounted.push({ slot: receipt.slot, role: receipt.role, reason: 'shared its vendor session with another seat' });
      continue;
    }
    if (session.length > 0) seenSessions.add(session);

    if (!receiptCounts(receipt) || !POSITIONS.includes(receipt.position)) {
      uncounted.push({ slot: receipt.slot, role: receipt.role, reason: receipt.voidReason || 'could not be counted' });
      continue;
    }
    // An approval with nothing behind it is an abstention: a checker that only agrees has
    // added nothing the builder did not already claim. A rejection stands whatever it says,
    // because a checker that objects has still refused to let the work land.
    if (receipt.position === 'APPROVE') {
      const judged = judgeEvidence(receipt.evidence);
      if (!judged.independent) {
        adjustments.push({ slot: receipt.slot, role: receipt.role, declared: 'APPROVE', counted: 'ABSTAIN', reason: judged.reason });
        counted.push({ receipt, position: 'ABSTAIN' });
        continue;
      }
      // Zero reads of a non-empty grant is a fact, not a judgment: the seat certified
      // criteria it could not have checked. A null observation (nothing was granted), an
      // empty directory and partial reading are all exempt - only exactly zero counts.
      const reads = receipt.evidenceRead;
      if (reads !== null && typeof reads === 'object' && reads.totalCount > 0 && reads.seenCount === 0) {
        adjustments.push({ slot: receipt.slot, role: receipt.role, declared: 'APPROVE', counted: 'ABSTAIN', reason: 'approved without opening the evidence it was granted' });
        counted.push({ receipt, position: 'ABSTAIN' });
        continue;
      }
    }
    counted.push({ receipt, position: receipt.position });
  }

  let approve = counted.filter((c) => c.position === 'APPROVE').length;
  let reject = counted.filter((c) => c.position === 'REJECT').length;
  let abstain = counted.filter((c) => c.position === 'ABSTAIN').length;
  const quorum = critical ? CRITICAL_QUORUM : ORDINARY_QUORUM;

  const independence = independenceOf(
    receipts.filter((r) => r.role === 'implement').concat(counted.map((c) => c.receipt)),
  );
  if (independence === 'checkersShareVendor') flags.push('both-checks-ran-on-one-vendor');
  if (independence === 'checkerSharesBuilder') flags.push('a-check-ran-on-the-vendor-that-built-it');
  if (independence === 'singleVendor') flags.push('the-whole-panel-ran-on-one-vendor');
  if (adjustments.length > 0) flags.push('approve-without-evidence-counted-as-abstain');
  if (counted.some((c) => c.position === 'APPROVE' && !hasAnchor(c.receipt.evidence))) {
    flags.push('evidence-names-nothing-to-look-at');
  }
  if (sameReason(counted.filter((c) => c.position === 'APPROVE').map((c) => c.receipt))) {
    flags.push('both-checkers-gave-the-same-reason');
  }

  // Two counted approvals from one vendor are one vendor's opinion twice. The seats are what
  // is counted; the vendor floor is what stops a panel being a monologue.
  const approvingVendors = new Set(
    counted.filter((c) => c.position === 'APPROVE').map((c) => c.receipt.vendor).filter(Boolean),
  );

  let outcome;
  if (counted.length < quorum) outcome = 'NOT_PANEL';
  else if (reject >= 2) outcome = 'REJECT';
  else if (approve >= quorum && reject === 0 && approvingVendors.size >= 2) outcome = 'PASSAGE';
  else outcome = 'DEADLOCK';
  if (approve >= quorum && reject === 0 && approvingVendors.size < 2) {
    flags.push('every-approval-came-from-one-vendor');
  }

  // The check has the last word on landing and only on landing: the votes are still counted
  // and still reported, because what the seats said about a failure is the most useful thing
  // the host can show.
  if (checkPassed === false && outcome === 'PASSAGE') {
    outcome = 'CHECK_FAILED';
    flags.push('the-unit-s-own-check-did-not-pass');
  }

  return { outcome, lands: outcome === 'PASSAGE', approve, reject, abstain, counted: counted.length, quorum, approvingVendors: approvingVendors.size, independence, adjustments, uncounted, flags };
}

module.exports = {
  AGREEMENT_ONLY, CRITICAL_QUORUM, FILLER, MIN_EVIDENCE_CHARS, MIN_EVIDENCE_WORDS,
  COUNTING_ROLES, ORDINARY_QUORUM, POSITIONS, ROLES,
  evidenceIn, hasAnchor, independenceOf, judgeEvidence, plainWords, positionIn, receiptCounts, verdict,
};
