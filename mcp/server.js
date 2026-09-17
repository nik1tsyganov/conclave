#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

// CONCLAVE as an MCP server: one plug, every host that speaks the protocol.
//
// Droppy Code reimplements the protocol natively because it wants seats to be chats a person
// can watch. Most hosts want no such thing; they want to call a panel and read the verdict.
// This is for them, and it is why there is no VS Code extension here: one stdio server
// reaches VS Code, Cursor, Zed, Claude Desktop and the JetBrains IDEs at once.
//
// THE SHAPE, AND WHY IT IS NOT ONE CALL
//
// A panel takes minutes to tens of minutes. An MCP call is request and response, and hosts
// time out long before that. So convening is not a call that waits: `conclave_seal` prepares a
// run and returns its directory, `conclave_drive` runs one phase and returns what happened, and
// the caller comes back for the next one. Droppy solved the same problem by making a seat a
// chat and reporting back later; here the run directory is what persists between calls.
//
// WHAT THIS SERVER WILL NOT DO
//
// It widens no policy. Every gate the CLI runtime applies still applies, because this calls
// the same tools rather than reimplementing them: proof of invocation, the dispatch matrix,
// the concurrency cap, and Claude's attestation stop. A tool here that spends subscription
// capacity says so in its description, and the two that do are refused unless the caller
// passes `spend: true`, so an agent cannot wander into a nine-seat run by autocomplete.

const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TOOLS_DIR = path.join(ROOT, 'tools');

const { CLI_HOST_MODES, HOST_MODES, ROLES, VENDORS, validateDispatchRow } = require(path.join(TOOLS_DIR, 'dispatch-schema.js'));
// The panel's own rules, not the older elector count in `position-tally.js`: that one answers
// a different question, about a bench of vendors rather than one unit's three seats.
const panelRules = require(path.join(TOOLS_DIR, 'panel-rules.js'));
const panelRouting = require(path.join(TOOLS_DIR, 'panel-routing.js'));
const panelBlock = require(path.join(TOOLS_DIR, 'panel-block.js'));

const SERVER_NAME = 'conclave-mcp';
const SERVER_VERSION = '0.1.0';
const LATEST_PROTOCOL = '2025-11-25';
const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/// A driving call runs vendor CLIs. It is capped so a stuck seat cannot hold the host open
/// for ever; the runtime has its own watchdogs underneath this one.
const DRIVE_TIMEOUT_MS = 45 * 60 * 1000;
const MAX_TEXT = 200000;

let initialized = false;

function warn(message) {
  process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function negotiateProtocol(requested) {
  return SUPPORTED_PROTOCOLS.includes(requested) ? requested : LATEST_PROTOCOL;
}

function fail(message, code = -32602) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.length === 0) fail(`"${field}" is required and must be a non-empty string.`);
  return value;
}

/// A path the caller named, resolved and checked for existence. A run directory is the one
/// piece of state that passes between calls, so a caller that mistypes one should hear about
/// it rather than have a run started somewhere unexpected.
function requireDirectory(value, field) {
  const resolved = path.resolve(requireString(value, field));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) fail(`${field} is not a directory: ${resolved}`);
  return resolved;
}

/// Refuses a call that would spend subscription capacity unless the caller said so out loud.
/// An agent exploring a tool list should not be able to start a nine-seat run by trying it.
function requireSpend(args, what) {
  if (args.spend !== true) {
    fail(`${what} runs vendor CLIs and spends subscription capacity. Pass "spend": true to confirm.`, -32602);
  }
}

function text(value) {
  const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text: body.length > MAX_TEXT ? `${body.slice(0, MAX_TEXT)}\n[truncated]` : body }] };
}

/// Runs one of the runtime's own tools as a child process.
///
/// Required rather than spawned would be shorter, and wrong: these are command-line tools
/// that call `process.exit` on a policy refusal. Required in, a refusal would take the
/// server down with it, and the host would see a dead pipe instead of the reason.
function runTool(script, argv, { timeout = 120000 } = {}) {
  const file = path.join(TOOLS_DIR, script);
  if (!fs.existsSync(file)) fail(`tool not found: ${script}`, -32603);
  const result = spawnSync(process.execPath, [file, ...argv], {
    cwd: ROOT,
    timeout,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error && result.error.code === 'ETIMEDOUT') fail(`${script} ran past ${Math.round(timeout / 1000)}s and was stopped.`, -32603);
  if (result.error) fail(`${script} could not run: ${result.error.message}`, -32603);
  return {
    status: result.status,
    ok: result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

const TOOLS = [
  {
    name: 'conclave_hosts',
    title: 'Legal hosts and what each one has to prove',
    description:
      'Lists the host modes a run may declare, and the vendors and roles a dispatch may name. ' +
      'Reads nothing and spends nothing. Use it to find out whether the host you are calling from can seal a run at all.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'conclave_validate_row',
    title: 'Check a telemetry row against the schema',
    description:
      'Validates one dispatch row, the JSON a host writes per seat. Answers whether it would be accepted, and why not when it would not. ' +
      'Deterministic and offline. This is how a host built elsewhere, such as Droppy Code, checks that its rows are readable here before writing a run.',
    inputSchema: {
      type: 'object',
      properties: {
        row: { type: 'object', description: 'The dispatch row to check.' },
        requireProof: { type: 'boolean', description: 'Require a proof id, a dispatch id and a unit id. Default true.' },
      },
      required: ['row'],
      additionalProperties: false,
    },
  },
  {
    name: 'conclave_tally',
    title: 'Count a panel into a verdict',
    description:
      'Counts one unit\'s seats the way the runtime does: two reasoned approvals carry it, an approval with no reason of its own counts as an abstention, ' +
      'a vote counts only from a seat that proved its vendor session and the model that answered, and a unit whose own check failed does not land whatever the seats voted. ' +
      'No model is asked what the panel meant. Offline, deterministic, spends nothing. This is what a host with its own interface calls instead of reimplementing the rules.',
    inputSchema: {
      type: 'object',
      properties: {
        receipts: {
          type: 'array',
          description: 'One per seat, the builder included: slot, vendor, role, position, evidence, status, sessionId, tokens, modelObserved, treeBefore, treeAfter.',
          items: { type: 'object' },
        },
        critical: { type: 'boolean', description: 'Raise the quorum to three, for a security-sensitive unit.' },
        checkPassed: { type: 'boolean', description: 'Whether the unit\'s own check passed. Omit when it named none.' },
      },
      required: ['receipts'],
      additionalProperties: false,
    },
  },
  {
    name: 'conclave_route',
    title: 'Decide who builds each unit and who checks it',
    description:
      'Routes a block\'s units across three seats: the class decides which vendor should build, a running count keeps one seat from authoring the whole block, ' +
      'two units may not claim the same file, and a security-sensitive unit is read a third time by the seat that verified it. ' +
      'Also says whether the panel can run here at all. Offline, deterministic, spends nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        units: { type: 'array', description: 'The units to route, each with id, brief and optionally files and class.', items: { type: 'object' } },
        seats: { type: 'array', description: 'The three seats: slot, vendor and name. Omit for the default arrangement.', items: { type: 'object' } },
        readyVendors: { type: 'array', description: 'The vendors set up on this machine.', items: { type: 'string' } },
        criticalTwoReviews: { type: 'boolean', description: 'Whether a security unit gets its second review. Default true.' },
      },
      required: ['units', 'readyVendors'],
      additionalProperties: false,
    },
  },
  {
    name: 'conclave_read_block',
    title: 'Read the units a lead asked for',
    description:
      'Finds the fenced block at the end of a lead\'s reply and reads its units, taking field names loosely so a synonym does not cost a round. ' +
      'Returns the reply with the block taken out, which is what the reader should see. An empty block asks for nothing and is not the same answer as one that cannot be read. Offline, spends nothing.',
    inputSchema: {
      type: 'object',
      properties: { reply: { type: 'string', description: 'The lead\'s reply, as it came back.' } },
      required: ['reply'],
      additionalProperties: false,
    },
  },
  {
    name: 'conclave_read_reply',
    title: 'Read a position and its evidence out of a seat reply',
    description:
      'Finds the one POSITION line and the last EVIDENCE line in a checker\'s reply, and says whether that evidence is a reason or bare agreement. ' +
      'A reply with two position lines, or one that argues against its own vote underneath it, is no vote at all. Offline, and spends nothing.',
    inputSchema: {
      type: 'object',
      properties: { reply: { type: 'string', description: 'The seat\'s reply, as it came back.' } },
      required: ['reply'],
      additionalProperties: false,
    },
  },
  {
    name: 'conclave_run_report',
    title: 'Read what a run did',
    description:
      'Reads a run directory and reports its dispatches, their proof and its verdict. Diagnostic only: it writes no evidence and grants no approval. Spends nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        runDir: { type: 'string', description: 'The run directory to read.' },
        outputDir: { type: 'string', description: 'A new directory to write the report into.' },
        phase: { type: 'string', description: 'Which phase to report. Defaults to finalize.' },
      },
      required: ['runDir', 'outputDir'],
      additionalProperties: false,
    },
  },
  {
    name: 'conclave_seal',
    title: 'Seal a plan into a run',
    description:
      'Checks a plan against the dispatch matrix and seals it into a run directory. Nothing runs yet, and no vendor is called. ' +
      'A plan that names a route the matrix does not allow, or a model with no fresh proof, is refused here rather than halfway through a panel.',
    inputSchema: {
      type: 'object',
      properties: {
        plan: { type: 'string', description: 'Path to the plan JSON.' },
        runDir: { type: 'string', description: 'A new directory for the sealed run.' },
        availability: { type: 'string', description: 'Path to the availability record, when the plan needs one.' },
      },
      required: ['plan', 'runDir'],
      additionalProperties: false,
    },
  },
  {
    name: 'conclave_drive',
    title: 'Run one phase of a sealed run',
    description:
      'SPENDS SUBSCRIPTION CAPACITY. Runs one phase of a sealed run: implement, verify, review, evidence or finalize. ' +
      'One phase per call, because a whole panel takes minutes to tens of minutes and no host waits that long for one tool call. ' +
      'A Claude seat stops at AWAITING_ATTESTATION: read its answer and call conclave_attest before driving the next phase. ' +
      'Requires "spend": true.',
    inputSchema: {
      type: 'object',
      properties: {
        runDir: { type: 'string', description: 'The sealed run directory.' },
        phase: { type: 'string', enum: ['implement', 'verify', 'review', 'evidence', 'finalize'], description: 'The phase to run.' },
        tests: { type: 'string', description: 'For the evidence phase: path to the tests JSON.' },
        spend: { type: 'boolean', description: 'Must be true. Confirms that this call runs vendor CLIs.' },
      },
      required: ['runDir', 'phase', 'spend'],
      additionalProperties: false,
    },
  },
  {
    name: 'conclave_attest',
    title: 'Attest that the host read a seat answer',
    description:
      'Passes the host attestation for one or more dispatches, which is what lets a Claude seat move past AWAITING_ATTESTATION. ' +
      'Only the host can do this, because only the host saw the answer. Spends nothing itself.',
    inputSchema: {
      type: 'object',
      properties: {
        runDir: { type: 'string', description: 'The sealed run directory.' },
        dispatchIds: { type: 'array', items: { type: 'string' }, description: 'The dispatch ids being attested.' },
      },
      required: ['runDir', 'dispatchIds'],
      additionalProperties: false,
    },
  },
];

async function callTool(name, rawArgs) {
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {};
  switch (name) {
    case 'conclave_hosts':
      return text({
        hostModes: HOST_MODES,
        cliHostModes: CLI_HOST_MODES,
        vendors: VENDORS,
        roles: ROLES,
        note:
          'A CLI host mode means the seats are native vendor CLIs, which is what proof of invocation rests on. ' +
          'cursor-cli and synara must also route by an arbiter; claude-code and droppy need not.',
      });

    case 'conclave_validate_row': {
      if (!args.row || typeof args.row !== 'object' || Array.isArray(args.row)) fail('"row" must be a JSON object.');
      const strict = args.requireProof !== false;
      try {
        validateDispatchRow(args.row, {
          requireHostMode: true,
          requireDispatchId: strict,
          requireUnitId: strict,
          requireProof: strict,
        });
        return text({ ok: true, hostMode: args.row.hostMode, vendor: args.row.vendor, role: args.row.role });
      } catch (error) {
        return text({ ok: false, reason: error.message });
      }
    }

    case 'conclave_tally': {
      if (!Array.isArray(args.receipts)) fail('"receipts" must be an array.');
      try {
        return text(panelRules.verdict({
          receipts: args.receipts,
          critical: args.critical === true,
          checkPassed: args.checkPassed === undefined ? null : args.checkPassed,
        }));
      } catch (error) {
        return text({ ok: false, reason: error.message });
      }
    }

    case 'conclave_route': {
      if (!Array.isArray(args.units)) fail('"units" must be an array.');
      if (!Array.isArray(args.readyVendors)) fail('"readyVendors" must be an array.');
      try {
        return text(panelRouting.route({
          units: args.units,
          seats: args.seats,
          readyVendors: args.readyVendors,
          criticalTwoReviews: args.criticalTwoReviews !== false,
        }));
      } catch (error) {
        return text({ ok: false, reason: error.message });
      }
    }

    case 'conclave_read_block': {
      const reply = requireString(args.reply, 'reply');
      return text({ hasBlock: panelBlock.hasBlock(reply), units: panelBlock.units(reply), without: panelBlock.without(reply) });
    }

    case 'conclave_read_reply': {
      const reply = requireString(args.reply, 'reply');
      const evidence = panelRules.evidenceIn(reply);
      const position = panelRules.positionIn(reply);
      return text({
        position,
        evidence,
        judged: position === 'APPROVE' ? panelRules.judgeEvidence(evidence) : null,
      });
    }

    case 'conclave_run_report': {
      const runDir = requireDirectory(args.runDir, 'runDir');
      const outputDir = path.resolve(requireString(args.outputDir, 'outputDir'));
      const argv = ['--run-dir', runDir, '--output-dir', outputDir];
      if (args.phase) argv.push('--phase', requireString(args.phase, 'phase'));
      const run = runTool('project-run-report.js', argv);
      return text({ ok: run.ok, stdout: run.stdout, stderr: run.stderr, outputDir });
    }

    case 'conclave_seal': {
      const plan = requireString(args.plan, 'plan');
      if (!fs.existsSync(path.resolve(plan))) fail(`plan not found: ${plan}`);
      const runDir = path.resolve(requireString(args.runDir, 'runDir'));
      const argv = ['--plan', path.resolve(plan), '--run-dir', runDir];
      if (args.availability) argv.push('--availability', path.resolve(requireString(args.availability, 'availability')));
      const run = runTool('plan-seal.js', argv, { timeout: 600000 });
      return text({ ok: run.ok, runDir, stdout: run.stdout, stderr: run.stderr });
    }

    case 'conclave_drive': {
      requireSpend(args, 'conclave_drive');
      const runDir = requireDirectory(args.runDir, 'runDir');
      const phase = requireString(args.phase, 'phase');
      const argv = ['--run-dir', runDir, '--phase', phase];
      if (phase === 'evidence') argv.push('--tests', path.resolve(requireString(args.tests, 'tests')));
      const run = runTool('run-drive.js', argv, { timeout: DRIVE_TIMEOUT_MS });
      return text({
        ok: run.ok,
        phase,
        runDir,
        stdout: run.stdout,
        stderr: run.stderr,
        next:
          run.stdout.includes('AWAITING_ATTESTATION')
            ? 'A seat is waiting on the host. Read its answer, then call conclave_attest with its dispatch id.'
            : 'Drive the next phase, or call conclave_run_report to read what happened.',
      });
    }

    case 'conclave_attest': {
      const runDir = requireDirectory(args.runDir, 'runDir');
      if (!Array.isArray(args.dispatchIds) || args.dispatchIds.length === 0) fail('"dispatchIds" must be a non-empty array.');
      const ids = args.dispatchIds.map((id, index) => requireString(id, `dispatchIds[${index}]`));
      const run = runTool('run-drive.js', ['--run-dir', runDir, '--attest', ids.join(',')], { timeout: 600000 });
      return text({ ok: run.ok, attested: ids, stdout: run.stdout, stderr: run.stderr });
    }

    default:
      fail(`Unknown tool: ${name}`, -32601);
      return undefined;
  }
}

async function handleRequest(message) {
  const { id, method, params } = message;
  if (!initialized && method !== 'initialize' && method !== 'ping') {
    sendError(id, -32002, 'Server not initialized. Send "initialize", then the "notifications/initialized" notification.');
    return;
  }
  switch (method) {
    case 'initialize':
      sendResult(id, {
        protocolVersion: negotiateProtocol(params && params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, title: 'CONCLAVE tri-vendor review panel', version: SERVER_VERSION },
        instructions:
          'Runs a tri-vendor review panel: one seat builds, two others check it in sessions of their own, and the votes are counted in code. ' +
          'Convening is not one call. Seal a plan, drive one phase at a time, attest what a seat said when it asks, then read the report. ' +
          'A vote counts only from a seat that proved its vendor session, its tokens and the model that answered. ' +
          'conclave_drive spends subscription capacity and refuses to run without "spend": true.',
      });
      return;

    case 'ping':
      sendResult(id, {});
      return;

    case 'tools/list':
      sendResult(id, { tools: TOOLS });
      return;

    case 'tools/call': {
      const name = params && params.name;
      if (typeof name !== 'string') {
        sendError(id, -32602, '"name" is required and must be a string.');
        return;
      }
      try {
        sendResult(id, await callTool(name, params ? params.arguments : {}));
      } catch (error) {
        sendError(id, typeof error.code === 'number' ? error.code : -32603, error.message || 'Tool call failed.');
      }
      return;
    }

    default:
      sendError(id, -32601, `Method not found: ${method}`);
  }
}

function handleMessage(message) {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    sendError(null, -32600, 'Invalid Request: expected a JSON-RPC object.');
    return;
  }
  if (typeof message.method !== 'string') return;
  // A notification has no id and must not be answered.
  if (message.id === undefined || message.id === null) {
    if (message.method === 'notifications/initialized') initialized = true;
    return;
  }
  handleRequest(message).catch((error) => {
    warn(`unhandled error in ${message.method}: ${error && error.stack}`);
    sendError(message.id, -32603, 'Internal error.');
  });
}

function main() {
  const lines = readline.createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      sendError(null, -32700, 'Parse error: each line must be one JSON-RPC message.');
      return;
    }
    handleMessage(message);
  });
  lines.on('close', () => process.exit(0));
}

if (require.main === module) main();

module.exports = { TOOLS, callTool, handleMessage, negotiateProtocol };
