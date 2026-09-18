// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SERVER = path.join(__dirname, 'server.js');

/// Drives the server over stdio the way a host does, one JSON-RPC message per line, and
/// returns the answers. Spawned rather than required, because what is under test is the
/// wire behaviour and not the functions behind it.
function talk(messages) {
  const input = messages.map((message) => JSON.stringify(message)).join('\n') + '\n';
  const result = spawnSync(process.execPath, [SERVER], { input, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined, String(result.error));
  return result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

const HELLO = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } };
const READY = { jsonrpc: '2.0', method: 'notifications/initialized' };

function call(name, args, id = 2) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}

/// The answer to the last request, for a conversation that also sends notifications. A
/// notification is not answered, so the answers never line up with the messages sent.
function last(messages) {
  const answers = talk(messages);
  return answers[answers.length - 1];
}

/// A ready host: the handshake, then one tool call.
function ask(name, args) {
  return last([HELLO, READY, call(name, args)]);
}

test('a host is answered before it has said anything else, and not served before it is ready', () => {
  const hello = last([HELLO]);
  assert.equal(hello.result.serverInfo.name, 'conclave-mcp');
  assert.equal(hello.result.protocolVersion, '2025-11-25');
  assert.match(hello.result.instructions, /counted in code/);

  // Skipping the initialized notification must not get a tool served.
  const early = last([HELLO, call('conclave_hosts', {})]);
  assert.equal(early.error.code, -32002);
  assert.match(early.error.message, /not initialized/);
});

test('an unknown protocol version is answered with one this server speaks', () => {
  const hello = last([{ ...HELLO, params: { protocolVersion: '1999-01-01' } }]);
  assert.equal(hello.result.protocolVersion, '2025-11-25');
});

test('the tool list is every tool, and each one says what it costs', () => {
  const list = last([HELLO, READY, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  const names = list.result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ['conclave_attest', 'conclave_drive', 'conclave_hosts', 'conclave_read_block', 'conclave_read_reply', 'conclave_route', 'conclave_run_report', 'conclave_seal', 'conclave_tally', 'conclave_validate_row']);
  const drive = list.result.tools.find((tool) => tool.name === 'conclave_drive');
  assert.match(drive.description, /SPENDS SUBSCRIPTION CAPACITY/);
  for (const tool of list.result.tools) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.ok(tool.description.length > 40, `${tool.name} says what it does`);
  }
});

test('the hosts tool names every legal host, Droppy among them', () => {
  const answer = ask('conclave_hosts', {});
  const body = JSON.parse(answer.result.content[0].text);
  assert.ok(body.cliHostModes.includes('droppy'), 'Droppy Code is a host');
  assert.ok(body.cliHostModes.includes('claude-code'));
  assert.ok(body.hostModes.includes('cursor'), 'the legacy Cursor Task mode is still named');
  assert.deepEqual(body.vendors, ['anthropic', 'openai', 'google']);
});

test('a row is checked against the same schema the runtime uses', () => {
  const good = {
    schemaVersion: 1, hostMode: 'droppy', vendor: 'anthropic', role: 'verify',
    dispatchId: 'verify-u1', unitId: 'u1', proofId: 'a'.repeat(64),
  };
  const ok = ask('conclave_validate_row', { row: good });
  assert.equal(JSON.parse(ok.result.content[0].text).ok, true);

  // A host nobody has heard of is refused, and the reason names the field.
  const bad = ask('conclave_validate_row', { row: { ...good, hostMode: 'banana' } });
  const refusal = JSON.parse(bad.result.content[0].text);
  assert.equal(refusal.ok, false);
  assert.match(refusal.reason, /hostMode/);

  // Proof is required by default and its absence is the reason given.
  const { proofId, ...noProof } = good;
  const missing = ask('conclave_validate_row', { row: noProof });
  assert.match(JSON.parse(missing.result.content[0].text).reason, /proofId/);
  const relaxed = ask('conclave_validate_row', { row: noProof, requireProof: false });
  assert.equal(JSON.parse(relaxed.result.content[0].text).ok, true);
});

test('the tally is the runtime\'s own, not a second copy of the rule', () => {
  const empty = JSON.parse(ask('conclave_tally', { receipts: [] }).result.content[0].text);
  // An empty panel must not read as a split: below the quorum it is not a panel at all.
  assert.equal(empty.outcome, 'NOT_PANEL');

  const seat = (slot, vendor, role, position, evidence) => ({
    slot, vendor, role, position, evidence, status: 'completed',
    sessionId: `s-${slot}`, tokens: 10, modelObserved: 'm', treeBefore: 'a', treeAfter: 'a',
  });
  const receipts = [
    seat('ponens', 'openai', 'implement', null, null),
    seat('scrutator', 'anthropic', 'verify', 'APPROVE', 'The six tests in stats_test.py pass, the even case included.'),
    seat('advocatus', 'google', 'review', 'APPROVE', 'I read the callers in app.py and none passes a tuple.'),
  ];
  assert.equal(JSON.parse(ask('conclave_tally', { receipts }).result.content[0].text).outcome, 'PASSAGE');
  // The gate a host must not be able to talk its way past.
  const red = JSON.parse(ask('conclave_tally', { receipts, checkPassed: false }).result.content[0].text);
  assert.equal(red.outcome, 'CHECK_FAILED');
  assert.equal(red.lands, false);
});

test('a reply is read for its one position and its last evidence', () => {
  const body = JSON.parse(ask('conclave_read_reply', {
    reply: 'EVIDENCE: one sentence naming a check\n\nI read it.\nPOSITION: APPROVE\nEVIDENCE: looks good',
  }).result.content[0].text);
  assert.equal(body.position, 'APPROVE');
  assert.equal(body.evidence, 'looks good');
  assert.equal(body.judged.independent, false, 'and the host is told the reason is bare');
  assert.equal(JSON.parse(ask('conclave_read_reply', { reply: 'POSITION: APPROVE\nPOSITION: REJECT' }).result.content[0].text).position, null);
});

test('routing and block reading are served whole, so a host reimplements neither', () => {
  const routed = JSON.parse(ask('conclave_route', {
    units: [{ id: 'C1', brief: 'b', class: 'security-sensitive', files: ['a.py'] }],
    readyVendors: ['openai', 'anthropic', 'google'],
  }).result.content[0].text);
  assert.equal(routed.units[0].builder, 'scrutator');
  assert.equal(routed.units[0].checkers.length, 3, 'a security unit is read a third time');
  assert.equal(routed.readiness.crossVendor, true);

  const short = JSON.parse(ask('conclave_route', { units: [{ id: 'U1', brief: 'b' }], readyVendors: ['openai'] }).result.content[0].text);
  assert.equal(short.units.length, 0, 'a panel that cannot run routes nothing');
  assert.match(short.dropped[0].reason, /all three seats ready/);

  const read = JSON.parse(ask('conclave_read_block', {
    reply: 'Here.\n\n```conclave\n[{"unit":"U1","brief":"1. Add it."}]\n```',
  }).result.content[0].text);
  assert.equal(read.hasBlock, true);
  assert.equal(read.units[0].id, 'U1');
  assert.equal(read.without, 'Here.', 'the block leaves the reply');
});

test('a call that would spend capacity is refused unless the caller says so', () => {
  const refused = ask('conclave_drive', { runDir: __dirname, phase: 'implement' });
  assert.ok(refused.error, 'no phase is driven by accident');
  assert.match(refused.error.message, /spend/);

  // And with the flag it gets as far as the run directory check, which is where a wrong
  // path should stop rather than halfway through a panel.
  const wrongDir = ask('conclave_drive', { runDir: '/nowhere/at/all', phase: 'implement', spend: true });
  assert.match(wrongDir.error.message, /runDir is not a directory/);
});

test('rules-only serves the judgement and nothing that runs a vendor', () => {
  const talkTo = (messages) => {
    const input = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
    const result = require('node:child_process').spawnSync(process.execPath, [SERVER, '--rules-only'], { input, encoding: 'utf8', timeout: 60000 });
    const answers = result.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return answers[answers.length - 1];
  };
  const list = talkTo([HELLO, READY, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  const names = list.result.tools.map((t) => t.name);
  assert.equal(names.length, 6);
  for (const name of ['conclave_drive', 'conclave_seal', 'conclave_attest', 'conclave_run_report']) {
    assert.ok(!names.includes(name), `${name} is not offered`);
  }
  for (const name of ['conclave_tally', 'conclave_route', 'conclave_read_block', 'conclave_read_reply']) {
    assert.ok(names.includes(name), `${name} is`);
  }
  // Hidden from the list is not the same as refused when asked for by name.
  const sneaky = talkTo([HELLO, READY, call('conclave_drive', { runDir: '/tmp', phase: 'implement', spend: true })]);
  assert.equal(sneaky.error.code, -32601);
  assert.match(sneaky.error.message, /rules-only/);
  // And the rules still answer.
  const routed = talkTo([HELLO, READY, call('conclave_route', { units: [{ id: 'U1', brief: 'b' }], readyVendors: ['openai', 'anthropic', 'google'] })]);
  assert.equal(JSON.parse(routed.result.content[0].text).units.length, 1);
});

test('bad input is answered, never crashed on', () => {
  assert.equal(ask('conclave_nonsense', {}).error.code, -32601);

  assert.equal(last([HELLO, READY, { jsonrpc: '2.0', id: 9, method: 'no/such/method' }]).error.code, -32601);

  // A notification carries no id and must not be answered at all.
  const quiet = talk([HELLO, READY, { jsonrpc: '2.0', method: 'notifications/cancelled' }]);
  assert.equal(quiet.length, 1, 'only the initialize answer comes back');
});

test('a line that is not JSON is a parse error and the server keeps going', () => {
  const input = 'not json\n' + JSON.stringify(HELLO) + '\n';
  const result = spawnSync(process.execPath, [SERVER], { input, encoding: 'utf8', timeout: 60000 });
  const answers = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(answers[0].error.code, -32700);
  assert.equal(answers[1].result.serverInfo.name, 'conclave-mcp', 'the next message is still served');
});

// A published rules-only package has no driver beside it. It should say so in its tool list
// rather than offering four tools whose first call fails (2026-09-18).
test('a distribution without the runtime serves the rules tools only, with no flag', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conclave-rules-only-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'mcp'));
  fs.mkdirSync(path.join(root, 'tools'));
  fs.copyFileSync(SERVER, path.join(root, 'mcp', 'server.js'));
  for (const name of ['dispatch-schema.js', 'panel-rules.js', 'panel-routing.js', 'panel-block.js']) {
    fs.copyFileSync(path.join(__dirname, '..', 'tools', name), path.join(root, 'tools', name));
  }
  const input = [HELLO, READY, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]
    .map((message) => JSON.stringify(message)).join('\n') + '\n';
  const result = spawnSync(process.execPath, [path.join(root, 'mcp', 'server.js')], { input, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined, String(result.error));
  const answers = result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const names = answers.find((row) => row.id === 2).result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ['conclave_hosts', 'conclave_read_block', 'conclave_read_reply', 'conclave_route', 'conclave_tally', 'conclave_validate_row']);
});
