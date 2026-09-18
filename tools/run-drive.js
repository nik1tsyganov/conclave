#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
// Run driver (2026-09-16): executes one phase of a sealed run so a CONCLAVE run is a
// few commands instead of a hand-written script. It never widens policy: every
// seat still goes through dispatch-run with its gates, Claude output still
// stops at AWAITING_ATTESTATION until the host reads the response and passes
// --attest <dispatchId>, and the concurrency cap still applies.
//
//   node tools/run-drive.js --run-dir <run> --phase implement|verify|review
//   node tools/run-drive.js --run-dir <run> --attest <dispatchId>[,<dispatchId>]
//   node tools/run-drive.js --run-dir <run> --phase evidence --tests <tests.json>
//   node tools/run-drive.js --run-dir <run> --phase finalize
//
// tests.json: { "<unitId>": { "command": "node --test test/sum.test.js" } } — run in
// the unit's worktree; output and diff land in every evidenceReadDir of that unit.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readSealedRun } = require('./plan-seal.js');
const { runDispatch } = require('./dispatch-run.js');
const { transactionKey, AWAITING_ATTESTATION } = require('./dispatch-evidence.js');

const PHASES = ['implement', 'verify', 'review', 'evidence', 'finalize'];

function transaction(run, entry) {
  const file = path.join(run.root, '.conclave-dispatches', `${transactionKey(entry)}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

async function drivePhase({ runDir, phase, rulesRoot, availability, skillSourceRoot, dependencies = {} }) {
  const run = readSealedRun(runDir);
  const entries = run.plan.dispatches.filter(e => e.role === phase);
  if (!entries.length) throw new Error(`no ${phase} dispatches in the sealed plan`);
  const base = { plan: run.planPath, runDir: run.root, rulesRoot, availability: availability || run.availablePath, skillSourceRoot: skillSourceRoot || run.seal.skillSource?.sourceRoot };
  const results = await Promise.all(entries.map(async entry => {
    const state = transaction(run, entry);
    if (state?.status === 'PASS') return { dispatchId: entry.dispatchId, status: 'PASS', replayed: true };
    try {
      const result = await runDispatch({ ...base, dispatchId: entry.dispatchId }, dependencies);
      if (result.ok) return { dispatchId: entry.dispatchId, status: 'PASS', modelObserved: result.receipt?.modelObserved };
      return { dispatchId: entry.dispatchId, status: result.status, responsePath: result.responsePath, captureSha256: result.captureSha256 };
    } catch (error) { return { dispatchId: entry.dispatchId, status: 'FAIL', code: error.code, error: error.message }; }
  }));
  // A unit that named a check has it run here, host-side, and written into the evidence
  // directory its checking seats are bound to. Doing it after implement and before anyone
  // drives verify is what makes a checking seat able to answer without running anything
  // itself — which is the one thing a sandboxed seat cannot do.
  const captured = phase === 'implement' && results.some(r => r.status === 'PASS')
    ? captureEvidence({ runDir }).results
    : [];
  return {
    phase,
    results,
    ...(captured.length ? { evidence: captured } : {}),
    pending: results.filter(r => r.status === AWAITING_ATTESTATION).map(r => r.dispatchId),
  };
}

async function attest({ runDir, dispatchIds, rulesRoot, availability, skillSourceRoot, dependencies = {} }) {
  const run = readSealedRun(runDir);
  const results = [];
  for (const dispatchId of dispatchIds) {
    const entry = run.plan.dispatches.find(e => e.dispatchId === dispatchId);
    if (!entry) throw new Error(`unknown dispatch: ${dispatchId}`);
    const state = transaction(run, entry);
    if (state?.status !== AWAITING_ATTESTATION) throw new Error(`${dispatchId} is not awaiting attestation (${state?.status || 'NOT_RUN'})`);
    const result = await runDispatch({ plan: run.planPath, runDir: run.root, rulesRoot, availability: availability || run.availablePath, skillSourceRoot: skillSourceRoot || run.seal.skillSource?.sourceRoot,
      dispatchId, onTopic: true, captureSha256: state.receipt.captureSha256 }, dependencies);
    results.push({ dispatchId, status: result.ok ? 'PASS' : result.status });
  }
  return { results };
}

/// The checks a sealed plan names for itself, in the shape captureEvidence takes. A plan that
/// names none returns nothing, and the driver captures nothing: this is a plan saying what
/// proves its unit, not the driver inventing a command to run in someone's worktree.
function plannedChecks(plan) {
  const spec = {};
  for (const entry of plan.dispatches) {
    if (!entry.check || !entry.check.command || spec[entry.unitId]) continue;
    spec[entry.unitId] = { command: entry.check.command, ...(entry.check.cwd ? { cwd: entry.check.cwd } : {}) };
  }
  return spec;
}

function captureEvidence({ runDir, tests }) {
  const run = readSealedRun(runDir);
  const spec = tests ? JSON.parse(fs.readFileSync(tests, 'utf8')) : plannedChecks(run.plan);
  if (!Object.keys(spec).length) return { results: [] };
  const out = [];
  for (const [unitId, test] of Object.entries(spec)) {
    const implement = run.plan.dispatches.find(e => e.unitId === unitId && e.role === 'implement');
    const cwd = test.cwd || implement?.cwd;
    if (!cwd) throw new Error(`no worktree for ${unitId}`);
    const dirs = [...new Set(run.plan.dispatches.filter(e => e.unitId === unitId).flatMap(e => e.evidenceReadDirs || []))];
    if (!dirs.length) throw new Error(`no evidenceReadDirs for ${unitId}`);
    const proc = spawnSync('/bin/sh', ['-c', test.command], { cwd, encoding: 'utf8', maxBuffer: 16e6 });
    const testOutput = `# lead-captured test evidence, unit ${unitId}, plan ${run.plan.planId}, ${new Date().toISOString()}\n# cwd: ${cwd}\n$ ${test.command}\n${proc.stdout || ''}${proc.stderr || ''}exit=${proc.status}\n`;
    const git = (args) => spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout || '';
    const diff = `$ git diff --stat && git diff && git status --porcelain\n${git(['diff', '--stat'])}${git(['diff'])}${git(['status', '--porcelain'])}`;
    for (const dir of dirs) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'test-output.txt'), testOutput); fs.writeFileSync(path.join(dir, 'diff.txt'), diff); }
    out.push({ unitId, exit: proc.status, dirs });
  }
  return { results: out };
}

function finalize({ runDir }) {
  const node = process.execPath;
  const tool = (name, args) => { const p = spawnSync(node, [path.join(__dirname, name), ...args], { encoding: 'utf8', maxBuffer: 32e6 }); return { exit: p.status, out: (p.stdout || '').trim().slice(-4000), err: (p.stderr || '').trim().slice(-800) }; };
  const run = readSealedRun(runDir);
  const finalizeResult = tool('run-finalize.js', ['--run-dir', run.root]);
  const activation = tool('activation-check.js', ['--run-dir', run.root]);
  let summary = null; try { summary = JSON.parse(activation.out.slice(activation.out.indexOf('{'))); } catch {}
  const units = [...new Set(run.plan.dispatches.map(e => e.unitId))].map(unitId => ({ unitId,
    tally: tool('panel-tally.js', ['--run-dir', run.root, '--unit-id', unitId]).out.slice(0, 600),
    jev: tool('panel-tally-jev.js', ['--run-dir', run.root, '--unit-id', unitId]).out.slice(0, 600) }));
  return { finalize: { exit: finalizeResult.exit, error: finalizeResult.exit === 0 ? null : finalizeResult.err || finalizeResult.out.slice(-300) },
    activation: summary ? { executionStatus: summary.executionStatus, approvalStatus: summary.approvalStatus, outcomes: summary.outcomes.map(o => `${o.dispatchId}:${o.status}`), units: summary.units } : { raw: activation.out.slice(-600), err: activation.err },
    units };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const opts = {};
    for (let i = 0; i < argv.length; i += 2) {
      if (!['--run-dir', '--phase', '--attest', '--tests', '--rules-root', '--availability', '--skill-source-root'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
        throw new Error('Usage: run-drive --run-dir <run> (--phase implement|verify|review|evidence|finalize [--tests <json>] | --attest <id[,id]>) [--rules-root <pack>] [--availability <json>] [--skill-source-root <dir>]');
      }
      opts[argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[i + 1];
    }
    if (!opts.runDir) throw new Error('--run-dir is required');
    const rulesRoot = opts.rulesRoot || process.env.CONCLAVE_RULES_ROOT;
    let result;
    if (opts.attest) result = await attest({ runDir: opts.runDir, dispatchIds: opts.attest.split(','), rulesRoot, availability: opts.availability, skillSourceRoot: opts.skillSourceRoot });
    else if (opts.phase === 'evidence') result = captureEvidence({ runDir: opts.runDir, tests: opts.tests });
    else if (opts.phase === 'finalize') result = finalize({ runDir: opts.runDir });
    else if (PHASES.includes(opts.phase)) result = await drivePhase({ runDir: opts.runDir, phase: opts.phase, rulesRoot, availability: opts.availability, skillSourceRoot: opts.skillSourceRoot });
    else throw new Error(`unknown phase: ${opts.phase}`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.pending?.length) { process.stderr.write(`AWAITING_ATTESTATION: read each response.txt, then run --attest ${result.pending.join(',')}\n`); return 3; }
    if (result.results?.some(r => r.status === 'FAIL')) return 1;
    return 0;
  } catch (error) { process.stderr.write(`RUN_DRIVE_FAIL: ${error.message}\n`); return 1; }
}

if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { PHASES, drivePhase, attest, captureEvidence, finalize };
