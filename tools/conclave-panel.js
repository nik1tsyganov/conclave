#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

// The panel's rules, for a host that draws its own interface.
//
// Droppy Code is the first of these: it owns the window, the chats and the provider sessions,
// and it asks here for the two things a host cannot sensibly own. What a reply says, and what
// the replies add up to. JSON in on stdin or a file, JSON out on stdout, exit 0 on an answer
// and 2 on a bad request. No filesystem, no network, no clock.
//
//   conclave-panel read   --input reply.txt      # the position and evidence in a reply
//   conclave-panel judge  --input evidence.txt   # whether a line is a reason or agreement
//   conclave-panel tally  --input panel.json     # the verdict
//
// `tally` takes { receipts: [...], critical?: bool, checkPassed?: bool|null }. A receipt is
// { slot, vendor, role, position, evidence, status, sessionId, tokens, modelObserved,
//   treeBefore, treeAfter, voidReason? }.

const fs = require('node:fs');
const rules = require('./panel-rules.js');

const COMMANDS = ['read', 'judge', 'tally'];

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function usage() {
  return `usage: conclave-panel <${COMMANDS.join('|')}> [--input <file>]\n` +
    '       --input - reads stdin, which is also the default';
}

function readInput(file) {
  const from = file === undefined || file === '-' ? 0 : file;
  try {
    return fs.readFileSync(from, 'utf8');
  } catch (error) {
    fail(`cannot read input: ${error.message}`);
    return '';
  }
}

function parseArgs(argv) {
  const command = argv[0];
  if (!COMMANDS.includes(command)) fail(usage());
  let input;
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--input') {
      input = argv[i + 1];
      if (input === undefined) fail('--input needs a value');
      i += 1;
    } else {
      fail(`unknown argument: ${argv[i]}`);
    }
  }
  return { command, input };
}

function main(argv = process.argv.slice(2)) {
  const { command, input } = parseArgs(argv);
  const text = readInput(input);

  if (command === 'read') {
    // The reply as it came back from the seat, not JSON: a position is a line in prose.
    const position = rules.positionIn(text);
    const evidence = rules.evidenceIn(text);
    const answer = { position, evidence, judged: position === 'APPROVE' ? rules.judgeEvidence(evidence) : null };
    process.stdout.write(`${JSON.stringify(answer)}\n`);
    return 0;
  }

  if (command === 'judge') {
    process.stdout.write(`${JSON.stringify(rules.judgeEvidence(text.trim()))}\n`);
    return 0;
  }

  let request;
  try {
    request = JSON.parse(text);
  } catch (error) {
    fail(`invalid JSON: ${error.message}`);
  }
  if (!request || typeof request !== 'object' || !Array.isArray(request.receipts)) {
    fail('tally needs { "receipts": [ ... ] }');
  }
  try {
    const answer = rules.verdict({
      receipts: request.receipts,
      critical: request.critical === true,
      checkPassed: request.checkPassed === undefined ? null : request.checkPassed,
    });
    process.stdout.write(`${JSON.stringify(answer)}\n`);
  } catch (error) {
    fail(`cannot count this panel: ${error.message}`);
  }
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { main, usage };
