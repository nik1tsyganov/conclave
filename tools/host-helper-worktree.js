#!/usr/bin/env node
// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { allowedWorkspace } = require('./cli-adapters.js');
const { writeJson } = require('./dispatch-evidence.js');

function bindWorktree({ cwd, out, env }) {
  if (!cwd) throw new Error('--cwd is required');
  const resolved = path.resolve(cwd);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new Error('cwd must be an existing directory');
  allowedWorkspace(resolved, env || process.env);
  const binding = {
    schemaVersion: 1,
    kind: 'host-helper-worktree',
    tally: 'never',
    position: false,
    cwd: resolved,
    note: 'Use this directory as a MAGI implement cwd. It is not a MAGI seat. synara_create_threads did not launch Casper, Balthasar, or Melchior.',
  };
  if (out) writeJson(path.resolve(out), binding);
  return binding;
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--cwd', '--out'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new Error('Usage: host-helper-worktree --cwd <directory> [--out <binding.json>]');
    }
    const key = argv[i].slice(2);
    if (Object.hasOwn(opts, key)) throw new Error(`duplicate option: ${argv[i]}`);
    opts[key] = argv[i + 1];
  }
  return opts;
}

function main(argv = process.argv.slice(2)) {
  try {
    const result = bindWorktree(parseArgs(argv));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`HOST_HELPER_WORKTREE_FAIL: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { bindWorktree, main };
