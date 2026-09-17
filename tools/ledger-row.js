#!/usr/bin/env node
'use strict';
// Emits the engineering-ledger row (schema v1.1) for a finalized run from its
// run-row.json and units.jsonl, so the ledger and the vault agree without hand
// copying. --append writes it to ~/.claude/docs/ENGINEERING-LOG.md (or --ledger <file>).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function ledgerRow(runDir, { task, size = 'medium', lead = 'claude', notes = '' } = {}) {
  const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run-row.json'), 'utf8'));
  const unitsFile = path.join(runDir, 'units.jsonl');
  const units = fs.existsSync(unitsFile) ? fs.readFileSync(unitsFile, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
  const dispatches = units.flatMap((u) => u.dispatches);
  const byRole = (role) => [...new Set(dispatches.filter((d) => d.role === role && d.status === 'PASS').map((d) => d.modelObserved || d.model))].join('+') || 'n/a';
  const verify = dispatches.filter((d) => d.role === 'verify');
  const review = dispatches.filter((d) => d.role === 'review');
  const count = (rows, pos) => rows.filter((d) => d.position === pos).length;
  const panels = units.map((u) => u.panel?.verdict).filter(Boolean);
  const tokens = Object.entries(run.tokensByVendor || {}).map(([v, t]) => `${v} ${Math.round(t / 1000)}k`).join(', ');
  const wall = run.wallMs ? `${Math.round(run.wallMs / 60000)} min` : 'n/a';
  const cells = [run.date, task || `MAGI run ${run.planId}`, size, lead, 'yes',
    `${run.dispatches} dispatches / ${units.length} units`, String(units.filter((u) => u.approval === 'FAIL').length),
    'sealed plan, evidence dirs, scope audit, native proof', `${run.pass} native proofs; panels ${panels.join('/') || 'n/a'}${units.some((u) => u.jev) ? '; jev tally' : ''}`,
    run.jevClassify ? `jev classify ${run.jevClassify.status}` : '1',
    `implement=${byRole('implement')}, verify=${byRole('verify')}, review=${byRole('review')}`,
    `verify APPROVE ${count(verify, 'APPROVE')}/${verify.length}, review APPROVE ${count(review, 'APPROVE')} REJECT ${count(review, 'REJECT')}/${review.length}; execution ${run.executionStatus}, approval ${run.approvalStatus}`,
    units.filter((u) => u.panel?.reject).map((u) => `${u.unitId}: reject by ${u.dispatches.find((d) => d.position === 'REJECT')?.vendor || '?'}`).join('; ') || 'none',
    `${tokens || 'n/a'} tokens, ${wall}`, 'pending (survival check ~30 days)', 'PASS', notes || `plan ${run.planId}`];
  return `| ${cells.map((c) => String(c).replace(/\|/g, '/')).join(' | ')} |`;
}

function main(argv = process.argv.slice(2)) {
  try {
    const opts = {};
    for (let i = 0; i < argv.length; i += 1) {
      if (argv[i] === '--append') { opts.append = true; continue; }
      if (!['--run-dir', '--task', '--size', '--lead', '--notes', '--ledger'].includes(argv[i]) || !argv[i + 1]) throw new Error('Usage: ledger-row --run-dir <run> [--task <label>] [--size trivial|small|medium|large] [--lead <who>] [--notes <text>] [--append [--ledger <file>]]');
      opts[argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    }
    if (!opts.runDir) throw new Error('--run-dir is required');
    const row = ledgerRow(opts.runDir, opts);
    if (opts.append) {
      const file = opts.ledger || path.join(os.homedir(), '.claude', 'docs', 'ENGINEERING-LOG.md');
      if (!fs.existsSync(file)) throw new Error(`ledger missing: ${file}`);
      fs.appendFileSync(file, `${row}\n`);
      process.stdout.write(`appended to ${file}\n`);
    } else process.stdout.write(`${row}\n`);
    return 0;
  } catch (error) { process.stderr.write(`LEDGER_ROW_FAIL: ${error.message}\n`); return 1; }
}
if (require.main === module) process.exitCode = main();
module.exports = { ledgerRow };
