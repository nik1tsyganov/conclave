#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { validateDispatchRow } = require('./dispatch-schema.js');
const { committedRunRoot, verifyCommittedRow } = require('./dispatch-evidence.js');
const { ensureVaultHome, looksSecret, requireVaultRoot, vaultError } = require('./magi-vault.js');

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    let row;
    try { row = JSON.parse(line); }
    catch (error) { throw vaultError(`vault telemetry is not JSONL at line ${index + 1}: ${error.message}`); }
    if (looksSecret(line)) throw vaultError('credential-looking content in vault telemetry; refused analysis write');
    return row;
  });
}

function hogFindings(rows) {
  const implementRows = rows.filter((row) => row.role === 'implement');
  if (!implementRows.length) return [{ id: 'hog:no-implement', severity: 'attention', detail: 'no implement rows; distribution floor cannot be scored' }];
  const findings = [];
  const groups = new Map();
  for (const row of implementRows) {
    try {
      if (row.schemaVersion !== 2) throw new Error('legacy row has no sealed plan context');
      validateDispatchRow(row, { requireProof: true });
      const key = JSON.stringify([row.planId, row.planHash]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    } catch (error) {
      findings.push({ id: 'hog:unmeasured', severity: 'attention', detail: `legacy or invalid plan context: ${error.message}` });
    }
  }
  for (const group of groups.values()) {
    const { planId, planHash } = group[0];
    const report = (id, severity, detail) => findings.push({ id, severity, planId, planHash, detail });
    const seen = new Set();
    let duplicate = false;
    for (const row of group) {
      const key = JSON.stringify([row.dispatchId, row.unitId, row.vendor]);
      if (seen.has(key)) { report('hog:duplicate', 'fail', `duplicate implement row ${row.dispatchId}/${row.unitId}/${row.vendor}`); duplicate = true; }
      seen.add(key);
    }
    if (duplicate) continue;
    try {
      // Load lazily: finalization can call the vault linker after publishing its exports.
      const { readSealedRun } = require('./plan-seal.js');
      const runRoot = committedRunRoot(group[0]);
      const run = readSealedRun(runRoot);
      if (run.plan.planId !== planId || run.seal.planHash !== planHash) throw new Error('sealed plan binding differs');
      const planned = run.plan.dispatches.filter(row => row.role === 'implement');
      const identity = row => [row.dispatchId, row.unitId, row.vendor];
      const ordered = rows => rows.map(identity).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      if (!isDeepStrictEqual(ordered(group), ordered(planned))) throw new Error('implementation rows are incomplete or differ from the sealed plan');
      for (const row of group) {
        if (committedRunRoot(row) !== runRoot) throw new Error('rows refer to different sealed runs');
        verifyCommittedRow(row);
      }
      // readSealedRun applies validatePlan's min(3, units) and configured share cap.
      report('hog:holds', 'ok', `sealed plan implementation distribution holds across ${planned.length} units; global rolling policy is not scored`);
    } catch (error) {
      report(error.code === 'POLICY_FAIL' ? 'hog:plan-invalid' : 'hog:unmeasured', error.code === 'POLICY_FAIL' ? 'fail' : 'attention', `sealed plan distribution cannot be scored: ${error.message}`);
    }
  }
  return findings;
}

function analyzeRows(rows) {
  const vendorByRole = { implement: {}, verify: {}, review: {} };
  const plannedNotRun = { rowCount: 0, vendorShare: { implement: {}, verify: {}, review: {} } };
  const outcomeKeys = ['dispatchId', 'unitId', 'role', 'vendor', 'class', 'planId', 'planHash', 'status'];
  const hostModes = {};
  let capturedByLead = 0;
  let missingCapturedBy = 0;
  let proofPresent = 0;
  let tokenPresent = 0;
  for (const row of rows) {
    // Only the exact non-call outcome shape emitted by inspectRun is exempt.
    // A NOT_RUN label with capture/proof/other fields remains visible for checks.
    if (row.status === 'NOT_RUN' && Object.keys(row).length === outcomeKeys.length
        && outcomeKeys.every(key => typeof row[key] === 'string' && row[key].trim())
        && /^[a-f0-9]{64}$/.test(row.planHash)) {
      plannedNotRun.rowCount += 1;
      const share = plannedNotRun.vendorShare[row.role];
      if (share) share[row.vendor] = (share[row.vendor] || 0) + 1;
      continue;
    }
    if (row.capturedBy === 'lead') capturedByLead += 1;
    else if (!row.capturedBy) missingCapturedBy += 1;
    if (row.role && vendorByRole[row.role] && row.vendor) {
      vendorByRole[row.role][row.vendor] = (vendorByRole[row.role][row.vendor] || 0) + 1;
    }
    if (row.hostMode) hostModes[row.hostMode] = (hostModes[row.hostMode] || 0) + 1;
    if (row.proofId) proofPresent += 1;
    if (typeof row.vendorSideTokens === 'number' || typeof row.totalTokens === 'number') tokenPresent += 1;
  }
  const activityRowCount = rows.length - plannedNotRun.rowCount;
  const findings = [];
  if (!rows.length) findings.push({ id: 'capture:zero-rows', severity: 'attention', detail: 'vault telemetry is empty; later MAGI analysis has nothing to score' });
  if (missingCapturedBy > 0) findings.push({ id: 'capture:missing-capturedBy', severity: 'attention', detail: `${missingCapturedBy} rows missing capturedBy` });
  if (activityRowCount && proofPresent / activityRowCount < 0.5) {
    findings.push({ id: 'proof:low', severity: 'attention', detail: `proofPresent ${proofPresent}/${activityRowCount}` });
  }
  if (activityRowCount && tokenPresent / activityRowCount < 0.5) {
    findings.push({ id: 'tokens:null-rate', severity: 'attention', detail: `token fields present on ${tokenPresent}/${activityRowCount} rows` });
  }
  findings.push(...hogFindings(rows));
  const needsAttention = findings.some((item) => item.severity !== 'ok');
  return {
    schemaVersion: 1,
    analyzedAt: new Date().toISOString(),
    rowCount: rows.length,
    activityRowCount,
    plannedNotRun,
    captureHealth: { capturedByLead, missingCapturedBy, proofPresent, tokenPresent },
    vendorShare: vendorByRole,
    hostMode: hostModes,
    globalDistribution: { status: 'unmeasured', detail: 'The separate global rolling-window breaker requires its own eligible completed window. This report does not clear or update it.' },
    findings,
    needsAttention,
  };
}

function renderAnalysisMarkdown(report) {
  const lines = [
    '# MAGI vault telemetry analysis',
    '',
    `Analyzed at: ${report.analyzedAt}`,
    `Rows: ${report.rowCount}`,
    `Planned NOT_RUN rows: ${report.plannedNotRun.rowCount}`,
    `Rows requiring capture checks: ${report.activityRowCount} (not a count of proven native calls)`,
    `Needs attention: ${report.needsAttention ? 'yes' : 'no'}`,
    '',
    '## Findings',
    '',
  ];
  for (const item of report.findings) lines.push(`- \`${item.severity}\` ${item.id} — ${item.detail}`);
  lines.push('', '## Vendor share', '');
  for (const role of ['implement', 'verify', 'review']) {
    const share = report.vendorShare[role];
    const parts = Object.entries(share).map(([vendor, count]) => `${vendor}:${count}`);
    lines.push(`- ${role}: ${parts.join(', ') || 'none'}`);
  }
  lines.push('', report.globalDistribution.detail, '', 'This file is the durable MAGI analysis snapshot. Raw JSONL stays gitignored.');
  return `${lines.join('\n')}\n`;
}

function analyzeVaultTelemetry(options = {}) {
  const layout = ensureVaultHome(requireVaultRoot(options));
  const report = analyzeRows(readJsonl(layout.telemetryLog));
  report.telemetryLog = layout.telemetryLog;
  fs.writeFileSync(layout.analysisLatestJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(layout.analysisLatestMd, renderAnalysisMarkdown(report), 'utf8');
  return report;
}

function main(argv = process.argv.slice(2), io = process) {
  try {
    if (argv.length) throw vaultError('Usage: magi-vault-analyze.js');
    const report = analyzeVaultTelemetry();
    io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.needsAttention ? 1 : 0;
  } catch (error) {
    io.stderr.write(`VAULT_ANALYZE_FAIL: ${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { analyzeRows, analyzeVaultTelemetry, hogFindings, main, readJsonl, renderAnalysisMarkdown };
