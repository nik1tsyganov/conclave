// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createSealedRun, fakeVendor, completeSyntheticDispatch } = require('./test-fixtures.js');
const { runDispatch } = require('./dispatch-run.js');
const { finalizeRun, inspectRun } = require('./run-finalize.js');
const { hash, hashFile, writeJson, snapshotWorkspace } = require('./dispatch-evidence.js');
const { INSTRUCTION_READ_PROTOCOL, codexReadTarget } = require('./instruction-read-evidence.js');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = text => text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const encode = values => values.map(value => JSON.stringify(value)).join('\n') + '\n';
const routes = [
  { vendor: 'anthropic', model: 'fable', effort: 'medium', class: 'standard-feature', role: 'implement', unitId: 'u1' },
  { vendor: 'openai', model: 'gpt-5.6-sol', effort: 'medium', class: 'test-verification', role: 'verify', authorVendor: 'anthropic', unitId: 'u1' },
  { vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high', class: 'review-adversarial', role: 'review', authorVendor: 'anthropic', unitId: 'u1' },
];

for (const route of routes) {
  test(`${route.vendor} ACK-only output cannot pass dispatch and preserves failed read evidence`, async t => {
    const run = createSealedRun(t, [route]); const native = fakeVendor();
    if (route.vendor === 'anthropic') {
      const execute = native.runLaunch;
      native.runLaunch = async launch => { const result = await execute(launch); result.stdout = encode(rows(result.stdout).filter(row => row.type === 'result')); return result; };
    } else {
      const key = route.vendor === 'openai' ? 'codexSessionTranscript' : 'googleSessionTranscript'; const collect = native[key];
      native[key] = (...args) => { const result = collect(...args); return { ...result, text: encode(rows(result.text).slice(0, 1)) }; };
    }
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), { code: 'INSTRUCTION_READ_FAIL' });
    const evidence = path.join(run.runDir, 'out/d1');
    assert.equal(json(path.join(evidence, 'receipt-ack.json')).status, 'FAIL');
    assert.equal(json(path.join(evidence, 'instruction-reads.json')).status, 'FAIL');
    assert.ok(fs.statSync(path.join(evidence, 'native-instructions.jsonl')).size > 0);
    assert.equal(fs.existsSync(path.join(run.runDir, '.magi-sessions')), false);
    assert.equal(fs.existsSync(path.join(run.runDir, 'telemetry/dispatches.jsonl')), false);
    assert.equal(native.calls(), 1);
  });

  test(`${route.vendor} replay and finalization recompute reads after transcript digest refresh`, async t => {
    const run = createSealedRun(t, [route]); const native = fakeVendor();
    const result = await completeSyntheticDispatch({ ...run.opts, dispatchId: 'd1' }, native);
    const state = json(result.receipt.transactionPath); const evidence = state.evidenceDir;
    const transcriptPath = path.join(evidence, 'native-instructions.jsonl'); const parsed = rows(fs.readFileSync(transcriptPath, 'utf8'));
    if (route.vendor === 'anthropic') parsed.find(row => row.tool_use_result?.file).tool_use_result.file.content = 'truncated';
    else if (route.vendor === 'openai') parsed.find(row => row.payload?.item?.type === 'CommandExecution').payload.item.stdout = 'truncated';
    else parsed.find(row => row.type === 'GENERIC').content = 'truncated';
    const changedText = encode(parsed); fs.writeFileSync(transcriptPath, changedText);
    const bindingPath = path.join(evidence, 'instruction-transcript.json'); const binding = json(bindingPath);
    binding.sha256 = hash(changedText); writeJson(bindingPath, binding);
    const changed = [transcriptPath, bindingPath];
    if (route.vendor === 'anthropic') { const capture = path.join(evidence, 'capture.txt'); fs.writeFileSync(capture, changedText); changed.push(capture); }
    for (const artifact of state.artifacts) if (changed.includes(artifact.path)) artifact.sha256 = hashFile(artifact.path);
    writeJson(result.receipt.transactionPath, state);
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), { code: 'INSTRUCTION_READ_FAIL' });
    const final = finalizeRun(run.runDir);
    assert.equal(final.executionStatus, 'FAIL'); assert.equal(final.outcomes[0].status, 'INVALID');
    assert.match(final.outcomes[0].error, /native read|native Read|content|header/);
    assert.equal(native.calls(), 1);
  });
}

test('all three complete native fixtures reach final approval and replay without collecting another transcript', async t => {
  const run = createSealedRun(t, routes); const native = fakeVendor();
  for (const entry of run.dispatches) {
    const result = await completeSyntheticDispatch({ ...run.opts, dispatchId: entry.dispatchId }, native);
    assert.equal(result.receipt.instructionReadProtocol, INSTRUCTION_READ_PROTOCOL);
    const report = json(path.join(run.runDir, 'out', entry.dispatchId, 'instruction-reads.json'));
    assert.equal(report.status, 'PASS'); assert.ok(report.files.length >= 7); assert.equal(report.applicationProven, undefined);
  }
  assert.equal(finalizeRun(run.runDir).ok, true);
  const noCollector = () => { throw new Error('replay called native transcript collector'); };
  native.codexSessionTranscript = noCollector; native.googleSessionTranscript = noCollector;
  for (const entry of run.dispatches) assert.equal((await runDispatch({ ...run.opts, dispatchId: entry.dispatchId }, native)).replayed, true);
  assert.equal(native.calls(), 3);
});

test('new seals require native read assurance and old completion cannot rewrite artifacts during current replay or finalize', async t => {
  const run = createSealedRun(t); const native = fakeVendor();
  await runDispatch({ ...run.opts, dispatchId: 'd1' }, native);
  const sealPath = path.join(run.runDir, 'plan-seal.json'); const seal = json(sealPath);
  assert.equal(seal.instructionReadProtocol, INSTRUCTION_READ_PROTOCOL);
  delete seal.instructionReadProtocol; writeJson(sealPath, seal);
  const before = snapshotWorkspace(run.runDir);
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), { code: 'INSTRUCTION_READ_COMPATIBILITY_FAIL' });
  assert.throws(() => finalizeRun(run.runDir), { code: 'INSTRUCTION_READ_COMPATIBILITY_FAIL' });
  assert.deepEqual(snapshotWorkspace(run.runDir), before); assert.equal(native.calls(), 1);
  assert.equal(inspectRun(run.runDir).outcomes[0].status, 'INVALID');
});

test('generated OpenAI contract carries exact unbatched reads for every staged file without a self-hash', async t => {
  const run = createSealedRun(t, [routes[1]]); const native = fakeVendor(launch => {
    const contract = fs.readFileSync(launch.seatContractPath, 'utf8');
    const commands = [...contract.matchAll(/const r = await tools\.exec_command\((\{[^\n]+\})\); text\(r.output\);/g)].map(match => JSON.parse(match[1]));
    assert.equal(commands.length, 7); // The bootstrap contract read is the 32nd required file.
    assert.ok(commands.every(command => command.workdir === launch.cwd && codexReadTarget(command.cmd)));
    assert.match(contract, /ONE functions.exec invocation per code block/);
    assert.ok(commands.every(command => !command.cmd.includes(launch.seatContractPath)));
  });
  assert.equal((await runDispatch({ ...run.opts, dispatchId: 'd1' }, native)).ok, true);
});
