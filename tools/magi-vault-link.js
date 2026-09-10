#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { appendUniqueRow, assertPlainPath, hash } = require('./dispatch-evidence.js');
const { analyzeVaultTelemetry } = require('./magi-vault-analyze.js');
const { ensureVaultHome, looksSecret, requireVaultRoot, vaultError } = require('./magi-vault.js');

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
  const pointer = {
    schemaVersion: 1,
    linkedAt: new Date().toISOString(),
    planId: rows.find((row) => row.planId)?.planId || null,
    planHash: rows.find((row) => row.planHash)?.planHash || null,
    rowCount: rows.length,
    appended,
    skipped,
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
    rowCount: rows.length,
    analysis,
    needsAttention: analysis ? analysis.needsAttention : false,
  };
}

function main(argv = process.argv.slice(2), io = process) {
  try {
    if (argv.length !== 2 || argv[0] !== '--run-dir') throw vaultError('Usage: magi-vault-link.js --run-dir <sealed run directory>');
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
