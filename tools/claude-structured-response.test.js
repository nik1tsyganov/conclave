'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { CLAUDE_RESPONSE_PROTOCOL, finalResponse } = require('./vendor-native.js');
const { parseClaude, verifyProof } = require('./cli-proof.js');
const { runDispatch } = require('./dispatch-run.js');
const { finalizeRun, inspectRun } = require('./run-finalize.js');
const { hashFile, writeJson } = require('./dispatch-evidence.js');
const { completeSyntheticDispatch, createSealedRun, fakeVendor, nativeCapture, temporary } = require('./test-fixtures.js');

const RESPONSE = 'ACK fixture\nPOSITION: APPROVE\nDone.';
const protocol = { responseProtocol: CLAUDE_RESPONSE_PROTOCOL };

function claudeRun(t) {
  return createSealedRun(t, [{ vendor: 'anthropic', model: 'sonnet', effort: 'medium', role: 'verify', class: 'test-verification', authorVendor: 'openai' }]);
}

function changeTerminal(native, mutate) {
  const run = native.runLaunch;
  native.runLaunch = async launch => {
    const result = await run(launch);
    const terminal = JSON.parse(result.stdout);
    const records = mutate(terminal) || [terminal];
    result.stdout = records.map(row => JSON.stringify(row)).join('\n');
    return result;
  };
  return native;
}

// Update only the artifact digest in a committed fixture. This lets replay
// validation reach the native protocol guard instead of stopping at a file hash.
function rewriteArtifact(result, file, update) {
  const state = JSON.parse(fs.readFileSync(result.receipt.transactionPath, 'utf8'));
  const artifact = path.join(state.evidenceDir, file);
  const value = update(JSON.parse(fs.readFileSync(artifact, 'utf8')));
  if (file === 'capture.txt') fs.writeFileSync(artifact, JSON.stringify(value), 'utf8');
  else writeJson(artifact, value);
  for (const item of state.artifacts.filter(item => item.path === artifact)) item.sha256 = hashFile(artifact);
  writeJson(result.receipt.transactionPath, state);
}

test('structured report extraction preserves native bytes and leaves plain probes unchanged', () => {
  const response = 'Unique "quoted" first line\r\nPOSITION: APPROVE\r\nThe source says auth required.\t\r\n';
  const native = nativeCapture('anthropic', 'claude-sonnet-5', 'medium', ' plain probe challenge ');
  const terminal = JSON.parse(native.capture);
  terminal.structured_output = { response };
  terminal.result = ' legacy narration remains separate ';
  const capture = JSON.stringify(terminal);
  assert.equal(finalResponse('anthropic', capture, protocol), response);
  assert.equal(finalResponse('anthropic', capture), 'legacy narration remains separate');
  const proof = parseClaude(capture, 'sonnet', 'medium', true, { ...protocol, expectedObservedModel: 'claude-sonnet-5', logText: native.log, requireObservedEffort: true });
  assert.equal(proof.responseProtocol, CLAUDE_RESPONSE_PROTOCOL);
  assert.equal(proof.effortObserved, 'medium');
  assert.equal(finalResponse('anthropic', native.capture), 'plain probe challenge');
  assert.equal(Object.hasOwn(parseClaude(native.capture, 'sonnet', 'medium', true, { expectedObservedModel: 'claude-sonnet-5' }), 'responseProtocol'), false);
  assert.throws(() => finalResponse('anthropic', native.capture, protocol), /structured_output/);
  assert.throws(() => finalResponse('anthropic', capture, { responseProtocol: 'legacy' }), /protocol/);
  assert.throws(() => finalResponse('google', capture, protocol), /another vendor/);
});

test('structured proof still requires native model, effort, session, numeric usage and status', t => {
  const root = temporary(t);
  const capture = path.join(root, 'capture.json');
  const log = path.join(root, 'native.log');
  const native = nativeCapture('anthropic', 'claude-sonnet-5', 'medium', RESPONSE);
  const terminal = { ...JSON.parse(native.capture), structured_output: { response: RESPONSE } };
  writeJson(capture, terminal);
  fs.writeFileSync(log, native.log, 'utf8');
  const options = { vendor: 'anthropic', capture, log, expectedModel: 'sonnet', expectedObservedModel: 'claude-sonnet-5', expectedEffort: 'medium', onTopic: true, ...protocol };
  assert.equal(verifyProof(options).responseProtocol, CLAUDE_RESPONSE_PROTOCOL);
  assert.throws(() => verifyProof({ ...options, expectedObservedModel: 'wrong-model' }), /model mismatch/);
  assert.throws(() => verifyProof({ ...options, expectedEffort: 'high' }), /effort mismatch/);
  assert.throws(() => verifyProof({ ...options, identityPolicy: 'allow-requested-only' }), /identity policy/);
  fs.writeFileSync(log, native.log.replace('"medium"', 'null'), 'utf8');
  assert.throws(() => verifyProof(options), /observed effort/);
  fs.writeFileSync(log, native.log.replace(terminal.session_id, 'wrong-session'), 'utf8');
  assert.throws(() => verifyProof(options), /observed effort/);
  fs.writeFileSync(log, native.log, 'utf8');
  writeJson(capture, { ...terminal, usage: { input_tokens: -1, output_tokens: 2 } });
  assert.throws(() => verifyProof(options), /usage/);
  writeJson(capture, { ...terminal, is_error: true });
  assert.throws(() => verifyProof(options), /error result/);
});

const malformed = [
  ['missing payload with valid legacy text', row => { delete row.structured_output; row.result = RESPONSE; }, /structured_output/],
  ['null payload', row => { row.structured_output = null; }, /structured_output/],
  ['array payload', row => { row.structured_output = [RESPONSE]; }, /structured_output/],
  ['string payload', row => { row.structured_output = RESPONSE; }, /structured_output/],
  ['missing response', row => { row.structured_output = {}; }, /structured_output/],
  ['wrong response type', row => { row.structured_output.response = 42; }, /structured_output/],
  ['null response', row => { row.structured_output.response = null; }, /structured_output/],
  ['array response', row => { row.structured_output.response = [RESPONSE]; }, /structured_output/],
  ['extra property', row => { row.structured_output.note = 'extra'; }, /structured_output/],
  ['empty response', row => { row.structured_output.response = ''; }, /structured_output/],
  ['whitespace response', row => { row.structured_output.response = ' \t\r\n'; }, /structured_output/],
  ['leading space', row => { row.structured_output.response = ` ${RESPONSE}`; }, /acknowledge/],
  ['leading newline', row => { row.structured_output.response = `\n${RESPONSE}`; }, /acknowledge/],
  ['prose prefix', row => { row.structured_output.response = `I completed the task.\n${RESPONSE}`; }, /acknowledge/],
  ['wrong first line', row => { row.structured_output.response = RESPONSE.replace('ACK fixture', 'BAD fixture'); }, /acknowledge/],
  ['duplicate terminal', row => [row, { ...row }], /exactly one terminal/],
  ['error terminal', row => { row.subtype = 'error_during_execution'; row.is_error = true; }, /error result/],
  ['unsuccessful terminal', row => { row.subtype = 'error_max_turns'; }, /successful final terminal/],
  ['wrong session', row => [{ type: 'system', subtype: 'init', model: 'claude-sonnet-5', session_id: 'other-session' }, row], /inconsistent sessions/],
  ['null native session', row => [{ type: 'assistant', session_id: null }, row], /inconsistent sessions/],
  ['missing terminal session', row => { delete row.session_id; }, /session identity/],
  ['event after terminal', row => [row, { type: 'assistant', session_id: row.session_id }], /successful final terminal/],
];

for (const [name, mutate, expected] of malformed) {
  test(`production dispatch rejects structured ${name}`, async t => {
    const run = claudeRun(t);
    const native = changeTerminal(fakeVendor(), mutate);
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), expected);
    assert.equal(native.calls(), 1);
    assert.equal(inspectRun(run.runDir).outcomes[0].status, 'FAIL');
    assert.equal(finalizeRun(run.runDir).executionStatus, 'FAIL');
    assert.equal(fs.existsSync(path.join(run.runDir, 'telemetry/dispatches.jsonl')), false);
  });
}

test('production launch binds the structured schema and protocol before a child can start', async t => {
  for (const alter of [
    launch => { delete launch.responseProtocol; },
    launch => { launch.responseProtocol = 'legacy-text'; },
    launch => { launch.args = []; },
    launch => { launch.args.push(...launch.args); },
    launch => { launch.args[1] = JSON.stringify({ type: 'object', additionalProperties: true }); },
  ]) {
    const run = claudeRun(t);
    const native = fakeVendor();
    const build = native.buildLaunch;
    native.buildLaunch = options => { const launch = build(options); alter(launch); return launch; };
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /protocol|schema/);
    assert.equal(native.calls(), 0);
  }
});

test('a child cannot rewrite its prelaunch structured response contract', async t => {
  const run = claudeRun(t);
  const native = fakeVendor(launch => {
    const file = path.join(path.dirname(launch.capturePath), 'launch.json');
    const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete metadata.responseProtocol;
    writeJson(file, metadata);
  });
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /protected input changed/);
  assert.equal(finalizeRun(run.runDir).executionStatus, 'FAIL');
});

test('production stores the protocol in launch and proof; native report survives finalization and replay', async t => {
  const run = claudeRun(t);
  const response = `${RESPONSE}\r\nTrailing native whitespace\t \r\n`;
  const native = fakeVendor(() => {}, response);
  const first = await completeSyntheticDispatch({ ...run.opts, dispatchId: 'd1' }, native);
  const folder = path.join(run.runDir, 'out/d1');
  for (const file of ['launch.json', 'proof.json']) assert.equal(JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8')).responseProtocol, CLAUDE_RESPONSE_PROTOCOL);
  assert.equal(inspectRun(run.runDir).executions[0].response, response);
  assert.equal(finalizeRun(run.runDir).executionStatus, 'PASS');
  const replay = await runDispatch({ ...run.opts, dispatchId: 'd1' }, native);
  assert.equal(replay.proofId, first.proofId);
  assert.equal(replay.replayed, true);
  assert.equal(native.calls(), 1);
});

test('finalization and replay reject malformed payloads after artifact hashes have been refreshed', async t => {
  for (const payload of [undefined, null, [], { response: null }, { response: RESPONSE, extra: true }]) {
    const run = claudeRun(t);
    const native = fakeVendor();
    const result = await completeSyntheticDispatch({ ...run.opts, dispatchId: 'd1' }, native);
    rewriteArtifact(result, 'capture.txt', row => ({ ...row, structured_output: payload, result: RESPONSE }));
    const final = finalizeRun(run.runDir);
    assert.equal(final.executionStatus, 'FAIL');
    assert.equal(final.outcomes[0].status, 'INVALID');
    assert.match(final.outcomes[0].error, /structured_output/);
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /structured_output/);
    assert.equal(native.calls(), 1);
  }
});

test('finalization and replay compare the unmodified first line even when native proof still matches', async t => {
  for (const response of [RESPONSE.replace('ACK fixture', 'BAD fixture'), ` ${RESPONSE.slice(0, -1)}`]) {
    const run = claudeRun(t);
    const native = fakeVendor();
    const result = await completeSyntheticDispatch({ ...run.opts, dispatchId: 'd1' }, native);
    rewriteArtifact(result, 'capture.txt', row => ({ ...row, structured_output: { response } }));
    const final = finalizeRun(run.runDir);
    assert.equal(final.outcomes[0].status, 'INVALID');
    assert.match(final.outcomes[0].error, /wrong brief acknowledgement/);
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /wrong brief acknowledgement/);
    assert.equal(native.calls(), 1);
  }
});

test('replay verifies native identity again instead of trusting committed proof fields', async t => {
  const run = claudeRun(t);
  const native = fakeVendor();
  const result = await completeSyntheticDispatch({ ...run.opts, dispatchId: 'd1' }, native);
  rewriteArtifact(result, 'capture.txt', row => ({ ...row, modelUsage: { 'wrong-model': { inputTokens: 100, outputTokens: 23 } } }));
  assert.match(inspectRun(run.runDir).outcomes[0].error, /model mismatch/);
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /model mismatch/);
  assert.equal(native.calls(), 1);
});

test('finalization and dispatch replay cannot downgrade committed protocol metadata', async t => {
  for (const file of ['launch.json', 'proof.json']) {
    const run = claudeRun(t);
    const native = fakeVendor();
    const result = await completeSyntheticDispatch({ ...run.opts, dispatchId: 'd1' }, native);
    rewriteArtifact(result, file, row => ({ ...row, responseProtocol: 'legacy-text' }));
    const final = finalizeRun(run.runDir);
    assert.equal(final.outcomes[0].status, 'INVALID');
    assert.match(final.outcomes[0].error, /protocol|native proof/);
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /protocol|native proof/);
    assert.equal(native.calls(), 1);
  }
});
