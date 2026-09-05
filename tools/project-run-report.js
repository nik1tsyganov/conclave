#!/usr/bin/env node
'use strict';

// Diagnostic output only. This tool never writes run evidence or grants approval.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectRun, assessRun } = require('./run-finalize.js');
const { readSealedRun } = require('./plan-seal.js');
const { transactionKey } = require('./dispatch-evidence.js');
const { canonicalPlainPath, pathsOverlap, DEFAULT_ROOT } = require('./runtime-paths.js');

const PHASES = ['preflight', 'probe', 'plan', 'dispatch', 'verify', 'review', 'finalize', 'activation', 'project'];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function createReport({ runDir, outputDir, phase = 'finalize', errorFile, projectRoot }) {
  if (!runDir || !outputDir || !PHASES.includes(phase)) throw new Error('runDir, a new outputDir, and a valid phase are required');
  const protectedRun = canonicalPlainPath(runDir);
  // Native canonicalization is for containment. Evidence paths retain the
  // producer's realpath spelling (Windows case and 8.3 aliases can differ).
  const root = fs.realpathSync(runDir);
  const destination = canonicalPlainPath(outputDir);
  if (!fs.statSync(root).isDirectory()) throw new Error('runDir must be an existing attempt/run directory');
  if (fs.existsSync(destination)) throw new Error('outputDir already exists; preserve the report and choose a new directory');
  const protectedRoots = [protectedRun, canonicalPlainPath(DEFAULT_ROOT), canonicalPlainPath(process.cwd())];
  if (projectRoot) {
    const product = canonicalPlainPath(projectRoot);
    if (!fs.statSync(product).isDirectory()) throw new Error('projectRoot must be an existing directory');
    protectedRoots.push(product);
  }
  // Damaged or unsealed plan text cannot establish a product write boundary.
  let declaredPlan;
  try { declaredPlan = readSealedRun(root).plan; } catch (error) {
    // An explicit product root is required below; integrity failure is reported later.
  }
  const declaredProducts = [];
  for (const entry of Array.isArray(declaredPlan?.dispatches) ? declaredPlan.dispatches : []) {
    if (typeof entry?.cwd === 'string' && path.isAbsolute(entry.cwd)) declaredProducts.push(canonicalPlainPath(entry.cwd));
  }
  if (!projectRoot && !declaredProducts.length) throw new Error('--project-root is required when a valid sealed plan cannot establish product worktrees');
  protectedRoots.push(...declaredProducts);
  if (protectedRoots.some(protectedRoot => pathsOverlap(protectedRoot, destination))) throw new Error('outputDir must be outside the run, product, current directory, and runtime');

  let commandFailure = null;
  if (errorFile) {
    const file = canonicalPlainPath(errorFile);
    if (pathsOverlap(file, destination)) throw new Error('outputDir overlaps errorFile');
    const bytes = fs.readFileSync(file);
    const decoded = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8').replace(/^\uFEFF/, '');
    commandFailure = { path: file, sha256: digest(bytes), excerpt: decoded.slice(0, 12000), truncated: decoded.length > 12000 };
  }
  const issues = [];
  let assessment = null;
  let dispatches = [];
  try {
    const run = inspectRun(root);
    assessment = assessRun(run);
    dispatches = run.outcomes.map(outcome => {
      const entry = run.plan.dispatches.find(row => row.dispatchId === outcome.dispatchId);
      const execution = run.executions.find(row => row.entry.dispatchId === outcome.dispatchId);
      const transactionPath = path.join(root, '.magi-dispatches', `${transactionKey(entry)}.json`);
      return { ...outcome, modelRequested: entry.model, effortRequested: entry.effort,
        modelObserved: execution?.proof.modelObserved ?? null,
        nativeId: execution?.proof.sessionId || execution?.proof.conversationId || null,
        evidenceDir: execution?.state.evidenceDir ?? outcome.evidenceDir ?? null,
        transactionPath: fs.existsSync(transactionPath) ? transactionPath : null };
    });
    for (const outcome of dispatches.filter(row => row.status !== 'PASS')) {
      issues.push({ kind: 'dispatch', dispatchId: outcome.dispatchId, unitId: outcome.unitId,
        status: outcome.status, message: outcome.error || `Dispatch is ${outcome.status}; no successful completion is proven.`,
        evidencePath: outcome.evidenceDir || outcome.transactionPath || root });
    }
    for (const unit of assessment.units.filter(row => row.status === 'FAIL')) issues.push({ kind: 'approval', unitId: unit.unitId, status: unit.status, message: unit.reason });
  } catch (error) {
    issues.push({ kind: 'run-integrity', status: 'UNVERIFIED', message: error.message, evidencePath: root });
  }
  if (commandFailure) issues.push({ kind: 'command', status: 'REPORTED_FAILURE', message: `The caller reported a failed ${phase} command. See the captured command output.`, evidencePath: commandFailure.path });
  const report = { schemaVersion: 1, recordedAt: new Date().toISOString(), phase, runDir: root,
    planId: assessment?.planId ?? null, planHash: assessment?.planHash ?? null,
    status: assessment?.ok && !commandFailure ? 'PASS' : 'NEEDS_ATTENTION',
    executionStatus: assessment?.executionStatus ?? 'UNVERIFIED', approvalStatus: assessment?.approvalStatus ?? 'UNVERIFIED',
    dispatches, issues, commandFailure,
    interpretation: 'Diagnostic snapshot, not activation evidence. NOT_RUN/RUNNING/AWAITING_ATTESTATION do not establish a defect or provider outage. Reproduce and classify each failure before fixing it.' };
  const lines = ['# MAGI project run report', '', `Status: **${report.status}**`, '',
    `Recorded: ${report.recordedAt}`, `Phase: ${phase}`, `Run: ${root}`, `Plan: ${report.planId || 'unverified'}`,
    `Execution: ${report.executionStatus}; approval: ${report.approvalStatus}`, '', report.interpretation, '',
    '## Findings', '', ...issues.map((issue, index) => `${index + 1}. [${issue.status}] ${issue.dispatchId || issue.unitId || issue.kind}: ${issue.message}`),
    ...(issues.length ? [] : ['No failures found in the available run evidence.']), '',
    '## Next action', '', 'Preserve this report and the original run. Classify findings as product, brief, environment, runtime, capacity, or unknown. Record the exact reproduction command and expected behavior. A correction uses a new plan/run. Never rewrite receipts to clear a failure.', '',
    'The JSON report contains native identities and evidence paths. Raw vendor output remains in the original run. Review private content before sharing outside your machine.', ''];
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(destination, 'REPORT.md'), lines.join('\n'), { flag: 'wx' });
  return { report, outputDir: destination };
}

function main(argv = process.argv.slice(2), io = process) {
  try {
    const options = {};
    const flags = { '--run-dir': 'runDir', '--output-dir': 'outputDir', '--phase': 'phase', '--error-file': 'errorFile', '--project-root': 'projectRoot' };
    for (let i = 0; i < argv.length; i += 2) {
      const key = flags[argv[i]];
      if (!key || options[key] || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Usage: project-run-report --run-dir <existing attempt/run> --output-dir <new external directory> [--project-root <required before sealing>] [--phase <phase>] [--error-file <failed command output>]');
      options[key] = argv[i + 1];
    }
    const result = createReport(options);
    io.stdout.write(`${JSON.stringify({ status: result.report.status, issueCount: result.report.issues.length, outputDir: result.outputDir })}\n`);
    return 0; // Recording a failed run successfully is a successful diagnostic export.
  } catch (error) { io.stderr.write(`PROJECT_REPORT_FAIL: ${error.message}\n`); return 2; }
}

if (require.main === module) process.exitCode = main();
module.exports = { createReport, main };
