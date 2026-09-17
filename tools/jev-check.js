#!/usr/bin/env node
// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with section 7 terms; see LICENSE.
'use strict';

/**
 * Jev supplement over a seat's output: deterministic pre-checks in code
 * first, then one batched request of per-claim Nouls. Seats never call
 * this; the lead runs it (no seat verifies what it wrote; the key stays
 * out of seat sandboxes).
 *
 * Input: {receiptPath} (JSON with claims[] and optional test {command, exitCode})
 *     or {claims:[{text, evidencePath, quote}]}; evidencePath resolves
 *     against the receipt's directory, else the cwd.
 * Pre-checks: the evidence path exists, the quote is a substring of the
 * file, and a recorded test exited 0. A claim that fails a pre-check is
 * discarded before Jev sees it (proof rule).
 * Outcomes: supported (support >= 0.6), contradicted (support <= 0.4),
 * says-nothing (excerpt does not address the claim, or Jev is split).
 *
 * CLI: node tools/jev-check.js --claims <json> | --receipt <json> [--provenance <jsonl>]
 */

const fs = require('node:fs');
const path = require('node:path');
const client = require('./jev-client.js');

const SUPPORT_GATE = 0.6;
const CONTRADICT_GATE = 0.4;
const ADDRESSES_GATE = 0.5;
const CONTEXT_LINES = 3;

function excerpt(text, quote) {
  const lines = text.split(/\r?\n/);
  const at = text.indexOf(quote);
  const line = text.slice(0, at).split(/\r?\n/).length - 1;
  const quoteLines = quote.split(/\r?\n/).length;
  return lines.slice(Math.max(0, line - CONTEXT_LINES), line + quoteLines + CONTEXT_LINES).join('\n');
}

function preCheck(claim, baseDir) {
  const file = path.resolve(baseDir, claim.evidencePath || '');
  if (!claim.evidencePath || !fs.existsSync(file) || !fs.statSync(file).isFile()) return { pass: false, reason: 'evidence path missing' };
  if (typeof claim.quote !== 'string' || !claim.quote) return { pass: false, reason: 'no quote' };
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(claim.quote)) return { pass: false, reason: 'quote not found in evidence' };
  return { pass: true, excerpt: excerpt(text, claim.quote) };
}

async function checkSeatOutput({ receiptPath, claims, systemOne = client.systemOne, provenancePath }) {
  let baseDir = process.cwd();
  let test = null;
  if (receiptPath) {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    claims = receipt.claims || [];
    test = receipt.test || null;
    baseDir = path.dirname(path.resolve(receiptPath));
  }
  const testExitedZero = test ? Number(test.exitCode) === 0 : null;

  const rows = (claims || []).map((claim, i) => ({ index: i, text: claim.text, evidencePath: claim.evidencePath, ...preCheck(claim, baseDir) }));
  const live = rows.filter((r) => r.pass);

  let result = { ok: false, notRun: 'no claims passed pre-checks' };
  if (live.length > 0) {
    const state = { claims: live.map((r) => ({ id: r.index, claim: r.text, evidence: r.excerpt })) };
    const questions = {};
    for (const r of live) {
      questions[`support_${r.index}`] = {
        type: 'noul',
        instructions: `Does the evidence excerpt for the claim with id ${r.index} in \`claims\` support that claim?`,
        criteria: { true: 'The excerpt establishes the claim as stated.', false: 'The excerpt contradicts the claim or shows it is overstated.' },
      };
      questions[`addresses_${r.index}`] = {
        type: 'noul',
        instructions: `Does the evidence excerpt for the claim with id ${r.index} in \`claims\` say anything about that claim at all, for or against?`,
        criteria: { true: 'The excerpt is about the thing the claim asserts.', false: 'The excerpt is unrelated to the claim or too thin to bear on it.' },
      };
    }
    result = await systemOne({ state, questions, provenancePath });
  }

  for (const r of rows) {
    delete r.excerpt;
    if (!r.pass) { r.outcome = 'discarded'; continue; }
    if (!result.ok) { r.outcome = 'not-run'; continue; }
    r.support = result.answers[`support_${r.index}`].noul;
    r.addresses = result.answers[`addresses_${r.index}`].noul;
    if (r.addresses < ADDRESSES_GATE) r.outcome = 'says-nothing';
    else if (r.support >= SUPPORT_GATE) r.outcome = 'supported';
    else if (r.support <= CONTRADICT_GATE) r.outcome = 'contradicted';
    else r.outcome = 'says-nothing';
  }
  return { testExitedZero, claims: rows, notRun: result.ok ? undefined : result.notRun, usage: result.usage || null };
}

function table(report) {
  const fmt = (p) => (typeof p === 'number' ? p.toFixed(2) : '-');
  const lines = ['# | pre-check | outcome | support | addresses | claim'];
  for (const r of report.claims) {
    lines.push(`${r.index} | ${r.pass ? 'pass' : r.reason} | ${r.outcome} | ${fmt(r.support)} | ${fmt(r.addresses)} | ${String(r.text).slice(0, 70)}`);
  }
  if (report.testExitedZero !== null) lines.push(`test command exited 0: ${report.testExitedZero}`);
  if (report.notRun) lines.push(`jev: NOT_RUN (${report.notRun})`);
  return lines.join('\n');
}

async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i += 1; }
  if (!args.claims && !args.receipt) {
    console.error('usage: node tools/jev-check.js --claims <json> | --receipt <json> [--provenance <jsonl>]');
    process.exit(2);
  }
  const report = await checkSeatOutput({
    receiptPath: args.receipt,
    claims: args.claims ? JSON.parse(fs.readFileSync(args.claims, 'utf8')) : undefined,
    provenancePath: args.provenance,
  });
  console.log(table(report));
  const bad = report.testExitedZero === false || report.claims.some((r) => r.outcome === 'discarded' || r.outcome === 'contradicted');
  process.exit(bad ? 1 : 0);
}

module.exports = { checkSeatOutput, table, preCheck };

if (require.main === module) main(process.argv.slice(2));
