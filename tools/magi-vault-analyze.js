#!/usr/bin/env node
// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const fs = require('node:fs');
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
  const seen = new Set();
  const findings = [];
  for (const row of implementRows) {
    const key = `${row.dispatchId}\u0000${row.unitId}\u0000${row.vendor}`;
    if (seen.has(key)) findings.push({ id: 'hog:duplicate', severity: 'fail', detail: `duplicate implement row ${row.dispatchId}/${row.unitId}/${row.vendor}` });
    seen.add(key);
  }
  const counts = {};
  for (const row of implementRows) counts[row.vendor] = (counts[row.vendor] || 0) + 1;
  const total = implementRows.length;
  for (const [vendor, count] of Object.entries(counts)) {
    const share = count / total;
    if (share > 0.6) findings.push({ id: 'hog:floor', severity: 'fail', detail: `${vendor} implement share ${Math.round(share * 100)}% exceeds 60%` });
  }
  const vendors = Object.keys(counts);
  if (vendors.length < 3) findings.push({ id: 'hog:idle-seat', severity: 'attention', detail: `expected 3 implement vendors, got ${vendors.length}` });
  if (!findings.length) findings.push({ id: 'hog:holds', severity: 'ok', detail: 'implement distribution floor holds' });
  return findings;
}

function analyzeRows(rows) {
  const vendorByRole = { implement: {}, verify: {}, review: {} };
  const hostModes = {};
  let capturedByLead = 0;
  let missingCapturedBy = 0;
  let proofPresent = 0;
  let tokenPresent = 0;
  const passed = rows.filter((row) => row.status === 'PASS');
  for (const row of rows) {
    // Only committed PASS rows carry capture, proof and token fields; FAIL and NOT_RUN rows are honest blanks (R17).
    if (row.status !== 'PASS') { if (row.role && vendorByRole[row.role] && row.vendor) vendorByRole[row.role][row.vendor] = (vendorByRole[row.role][row.vendor] || 0) + 1; continue; }
    if (row.capturedBy === 'lead') capturedByLead += 1;
    else if (!row.capturedBy) missingCapturedBy += 1;
    if (row.role && vendorByRole[row.role] && row.vendor) {
      vendorByRole[row.role][row.vendor] = (vendorByRole[row.role][row.vendor] || 0) + 1;
    }
    if (row.hostMode) hostModes[row.hostMode] = (hostModes[row.hostMode] || 0) + 1;
    if (row.proofId) proofPresent += 1;
    if (typeof row.vendorSideTokens === 'number' || typeof row.totalTokens === 'number') tokenPresent += 1;
  }
  const findings = [];
  if (!rows.length) findings.push({ id: 'capture:zero-rows', severity: 'attention', detail: 'vault telemetry is empty; later MAGI analysis has nothing to score' });
  if (missingCapturedBy > 0) findings.push({ id: 'capture:missing-capturedBy', severity: 'attention', detail: `${missingCapturedBy} rows missing capturedBy` });
  if (passed.length && proofPresent / passed.length < 0.5) {
    findings.push({ id: 'proof:low', severity: 'attention', detail: `proofPresent ${proofPresent}/${passed.length} PASS rows` });
  }
  if (passed.length && tokenPresent / passed.length < 0.9) {
    findings.push({ id: 'tokens:null-rate', severity: 'attention', detail: `token fields present on ${tokenPresent}/${passed.length} PASS rows` });
  }
  findings.push({ id: 'outcomes', severity: 'ok', detail: `${passed.length} PASS, ${rows.filter((r) => r.status === 'FAIL').length} FAIL, ${rows.filter((r) => r.status === 'NOT_RUN').length} NOT_RUN of ${rows.length} rows` });
  findings.push(...hogFindings(rows));
  const needsAttention = findings.some((item) => item.severity !== 'ok');
  return {
    schemaVersion: 1,
    analyzedAt: new Date().toISOString(),
    rowCount: rows.length,
    captureHealth: { capturedByLead, missingCapturedBy, proofPresent, tokenPresent },
    vendorShare: vendorByRole,
    hostMode: hostModes,
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
  lines.push('', 'This file is the durable MAGI analysis snapshot. Raw JSONL stays gitignored.');
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
