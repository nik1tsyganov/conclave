#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
// Jev tally (2026-09-16): the typed counterpart of panel-tally. Reads the unit's
// committed PASS verify/review transactions, extracts each native response and
// its final POSITION line, and asks the Jev decision engine whether each reply
// carries independent evidence and where the panel lands. Code still counts the
// votes (jev-arbiter.tallyPositions); Jev proposes the evidence and verdict
// distributions. Writes <run-dir>/jev-tally-<unit>.json and a provenance row.
const fs = require('node:fs');
const path = require('node:path');
const { readSealedRun } = require('./plan-seal.js');
const { transactionKey } = require('./dispatch-evidence.js');
const { finalResponse, CLAUDE_RESPONSE_PROTOCOL } = require('./vendor-native.js');
const { tallyPositions } = require('./jev-arbiter.js');

function position(text) { const m = [...String(text).matchAll(/^\s*POSITION:\s*(APPROVE|REJECT|ABSTAIN)\s*$/gm)]; return m.length === 1 ? m[0][1] : null; }

async function tallyUnit({ runDir, unitId, systemOne, provenancePath }) {
  if (!runDir || !unitId) throw new Error('--run-dir and --unit-id are required');
  const run = readSealedRun(runDir);
  const author = run.plan.dispatches.find(d => d.unitId === unitId && d.role === 'implement')?.vendor || null;
  const replies = [];
  for (const entry of run.plan.dispatches.filter(d => d.unitId === unitId && ['verify', 'review'].includes(d.role))) {
    const file = path.join(run.root, '.conclave-dispatches', `${transactionKey(entry)}.json`);
    if (!fs.existsSync(file)) { replies.push({ seat: null, dispatchId: entry.dispatchId, vendor: entry.vendor, role: entry.role, position: null, reason: 'NOT_RUN' }); continue; }
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (state.status !== 'PASS') { replies.push({ seat: null, dispatchId: entry.dispatchId, vendor: entry.vendor, role: entry.role, position: null, reason: state.status }); continue; }
    if (entry.vendor === author) { replies.push({ seat: null, dispatchId: entry.dispatchId, vendor: entry.vendor, role: entry.role, position: null, reason: 'author-recusal' }); continue; }
    const capture = fs.readFileSync(path.join(state.evidenceDir, 'capture.txt'), 'utf8');
    const text = finalResponse(entry.vendor, capture, entry.vendor === 'anthropic' ? { responseProtocol: CLAUDE_RESPONSE_PROTOCOL } : {});
    replies.push({ dispatchId: entry.dispatchId, vendor: entry.vendor, role: entry.role, position: position(text), text: text.slice(0, 8000) });
  }
  const eligible = replies.filter(r => r.position);
  eligible.forEach((r, i) => { r.seat = String.fromCharCode(65 + i); });
  const tally = await tallyPositions({ replies: eligible.map(r => ({ seat: r.seat, position: r.position, text: r.text })) }, { systemOne, provenancePath: provenancePath || path.join(run.root, 'jev-decisions.jsonl') });
  const out = { schemaVersion: 1, planId: run.plan.planId, planHash: run.seal.planHash, unitId, author, talliedAt: new Date().toISOString(),
    seats: eligible.map(r => ({ seat: r.seat, dispatchId: r.dispatchId, vendor: r.vendor, role: r.role, position: r.position })),
    excluded: replies.filter(r => !r.position).map(({ text, ...r }) => r), ...tally };
  const file = path.join(run.root, `jev-tally-${unitId}.json`);
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  return { ...out, file };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const opts = {};
    for (let i = 0; i < argv.length; i += 2) {
      if (!['--run-dir', '--unit-id', '--provenance'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Usage: panel-tally-jev --run-dir <run> --unit-id <unit> [--provenance <jsonl>]');
      opts[argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[i + 1];
    }
    const result = await tallyUnit({ runDir: opts.runDir, unitId: opts.unitId, provenancePath: opts.provenance });
    const { file, ...rest } = result; void rest;
    process.stdout.write(`${JSON.stringify({ ok: true, file, verdict: result.verdict, counts: result.counts, jev: result.jev || null, flags: result.flags, degraded: result.degraded })}\n`);
    return 0;
  } catch (error) { process.stderr.write(`JEV_TALLY_FAIL: ${error.message}\n`); return 1; }
}
if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { tallyUnit, position };
