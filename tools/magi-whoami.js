#!/usr/bin/env node
'use strict';

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
    const slug = require('./dispatch-matrix.js').loadMatrix().principles?.arbiterModel;
    if (typeof slug !== 'string' || !slug) throw new Error('POLICY_ERROR: runtime matrix has no arbiterModel');
    if (options['--mode'] !== 'cursor-cli' || options['--slug'] !== slug) {
      io.stderr.write(`ILLEGAL: cursor-cli requires the runtime arbiter slug ${slug}. Declaration only; not proof of the actual picker.\n`);
      return 1;
    }
    io.stdout.write(`LEGAL: cursor-cli ${slug}. Declaration only; not proof of the actual picker.\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { main };
