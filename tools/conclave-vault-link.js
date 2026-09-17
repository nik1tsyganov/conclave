#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { appendUniqueRow, assertPlainPath, hash } = require('./dispatch-evidence.js');
const { analyzeVaultTelemetry } = require('./conclave-vault-analyze.js');
const { ensureVaultHome, looksSecret, requireVaultRoot, vaultError } = require('./conclave-vault.js');

function parseJsonl(file) {
  if (!fs.existsSync(file)) throw vaultError(`run telemetry is missing: ${file}`);
  assertPlainPath(file);
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    let row;
    try { row = JSON.parse(line); }
    catch (error) { throw vaultError(`run telemetry is not JSONL at line ${index + 1}: ${error.message}`); }
    if (looksSecret(line)) throw vaultError('credential-looking content in run telemetry; refused vault write');
    return row;
  });
}

function linkRunToVault(options = {}) {
  const runDir = path.resolve(options.runDir || '');
  if (!runDir) throw vaultError('linkRunToVault requires runDir');
  const layout = ensureVaultHome(requireVaultRoot(options));
  const rows = parseJsonl(path.join(runDir, 'telemetry.jsonl'));
  let appended = 0;
  let skipped = 0;
  for (const row of rows) {
    if (appendUniqueRow(layout.telemetryLog, row)) appended += 1;
    else skipped += 1;
  }
  // Completion rows (2026-09-16): one per unit and one per run, keyed for idempotence.
  const appendKeyed = (file, row) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l).key; } catch { return null; } }) : [];
    if (existing.includes(row.key)) return false;
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`); return true;
  };
  const unitRows = fs.existsSync(path.join(runDir, 'units.jsonl')) ? parseJsonl(path.join(runDir, 'units.jsonl')) : [];
  let unitsAppended = 0; for (const row of unitRows) if (appendKeyed(layout.unitsLog, row)) unitsAppended += 1;
  const runRowPath = path.join(runDir, 'run-row.json');
  const runRow = fs.existsSync(runRowPath) ? JSON.parse(fs.readFileSync(runRowPath, 'utf8')) : null;
  const runAppended = runRow ? appendKeyed(layout.runsLog, runRow) : false;
  const pointer = {
    schemaVersion: 1,
    linkedAt: new Date().toISOString(),
    planId: rows.find((row) => row.planId)?.planId || null,
    planHash: rows.find((row) => row.planHash)?.planHash || null,
    rowCount: rows.length,
    appended,
    skipped,
    unitsAppended, runAppended,
    sourceTelemetry: path.join(runDir, 'telemetry.jsonl'),
  };
  const name = `${pointer.planId || 'run'}-${hash(pointer.sourceTelemetry).slice(0, 12)}.json`;
  const pointerPath = path.join(layout.runsDir, name);
  fs.writeFileSync(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`, 'utf8');
  const analysis = options.analyze === false ? null : analyzeVaultTelemetry(options);
  return {
    ok: true,
    vaultRoot: layout.root,
    telemetryLog: layout.telemetryLog,
    pointerPath,
    appended,
    skipped,
    unitsAppended, runAppended, unitsLog: layout.unitsLog, runsLog: layout.runsLog,
    rowCount: rows.length,
    analysis,
    needsAttention: analysis ? analysis.needsAttention : false,
  };
}

function main(argv = process.argv.slice(2), io = process) {
  try {
    if (argv.length !== 2 || argv[0] !== '--run-dir') throw vaultError('Usage: conclave-vault-link.js --run-dir <sealed run directory>');
    const result = linkRunToVault({ runDir: argv[1] });
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.needsAttention ? 1 : 0;
  } catch (error) {
    io.stderr.write(`VAULT_LINK_FAIL: ${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { linkRunToVault, main };
