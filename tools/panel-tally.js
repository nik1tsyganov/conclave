#!/usr/bin/env node
'use strict';
const { inspectRun, tallyUnit } = require('./run-finalize.js');
function main(argv = process.argv.slice(2)) {
  try {
    if (argv.length !== 4 || argv[0] !== '--run-dir' || argv[2] !== '--unit-id') throw new Error('Usage: panel-tally --run-dir <sealed run directory> --unit-id <unit>');
    const run = inspectRun(argv[1]);
    if (run.outcomes.some((row) => row.unitId === argv[3] && row.status !== 'PASS')) throw new Error('unit has missing, failed or invalid dispatches');
    const result = tallyUnit(run, argv[3]);
    process.stdout.write(`${JSON.stringify(result)}\n`); return result.passed ? 0 : 1;
  } catch (error) { process.stderr.write(`PANEL_TALLY_FAIL: ${error.message}\n`); return 1; }
}
if (require.main === module) process.exitCode = main();
module.exports = { main };
