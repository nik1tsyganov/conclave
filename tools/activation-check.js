#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { finalizeRun } = require('./run-finalize.js');
const { verifyCommittedRow } = require('./dispatch-evidence.js');

function main(argv = process.argv.slice(2)) {
  try {
    let runDir;
    if (argv.length === 2 && argv[0] === '--run-dir') runDir = argv[1];
    else if (argv.length === 1) {
      const file = path.resolve(argv[0]);
      if (!fs.existsSync(file)) { process.stderr.write('NO LIVE LOG\n'); return 2; }
      const text = fs.readFileSync(file, 'utf8').trim();
      for (const name of ['dispatch-log.pass.jsonl', 'dispatch-log.fail.jsonl']) {
        if (text === fs.readFileSync(path.join(__dirname, name), 'utf8').trim()) { process.stderr.write('FIXTURE LOG — NOT AN ACTIVATION\n'); return 1; }
      }
      const rows = text.split(/\r?\n/).filter(Boolean).map(JSON.parse);
      if (!rows.length) throw new Error('empty dispatch log');
      const roots = new Set();
      for (const row of rows) { verifyCommittedRow(row); roots.add(path.dirname(path.dirname(row.transactionPath))); }
      if (roots.size !== 1) throw new Error('activation log contains multiple runs');
      runDir = [...roots][0];
    } else throw new Error('Usage: activation-check --run-dir <sealed run> | <committed dispatch log>');
    const result = finalizeRun(runDir);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.ok ? 0 : 1;
  } catch (error) { process.stderr.write(`ACTIVATION_FAIL: ${error.message}\n`); return 1; }
}
if (require.main === module) process.exitCode = main();
module.exports = { main };
