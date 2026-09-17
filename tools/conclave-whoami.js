#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

// Declares which session hosts a CONCLAVE run. Since 2026-09-16 the arbiter is the
// Jev decision engine named by the runtime matrix; the host session runs the
// tools and holds no vote, so any host slug is legal in a CLI host mode.
const { CLI_HOST_MODES: HOST_MODES } = require('./dispatch-schema.js');

function main(argv = process.argv.slice(2), io = process) {
  try {
    const invalid = 'ARGUMENT_ERROR: expected exactly --mode <mode> and --slug <slug>';
    if (!Array.isArray(argv) || argv.length !== 4) throw new Error(invalid);
    const options = {};
    for (let i = 0; i < argv.length; i += 2) {
      const flag = argv[i];
      const value = argv[i + 1];
      if (!['--mode', '--slug'].includes(flag) || Object.hasOwn(options, flag) ||
          typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw new Error(invalid);
      options[flag] = value;
    }
    const principles = require('./dispatch-matrix.js').loadMatrix().principles || {};
    const engine = principles.arbiterModel;
    if (typeof engine !== 'string' || !engine) throw new Error('POLICY_ERROR: runtime matrix has no arbiterModel');
    const mode = options['--mode'];
    if (!HOST_MODES.includes(mode)) {
      io.stderr.write(`ILLEGAL: host mode must be one of ${HOST_MODES.join(', ')}. Declaration only; not proof of the actual picker.\n`);
      return 1;
    }
    io.stdout.write(`LEGAL: ${mode} host=${options['--slug']} arbiter=${principles.arbiterVendor}/${engine}. Declaration only; not proof of the actual picker.\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { main, HOST_MODES };
