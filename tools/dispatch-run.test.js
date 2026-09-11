'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseArgs, runDispatch } = require('./dispatch-run.js');
const { createSealedRun, fakeVendor } = require('./test-fixtures.js');
const { inspectRun, finalizeRun } = require('./run-finalize.js');
const { hashFile, writeJson } = require('./dispatch-evidence.js');

for (const route of require('./dispatch-matrix.js').loadMatrix().classes['test-verification'].verify) {
  test(`${route.vendor} contract requires reads from actual staged instruction files before task work`, async (t) => {
    const run = createSealedRun(t, [{ vendor: route.vendor, model: route.model, effort: route.effort,
      role: 'verify', class: 'test-verification', authorVendor: route.vendor === 'openai' ? 'anthropic' : 'openai' }]);
    // Product-local decoys must not become the instruction lookup location.
    fs.writeFileSync(path.join(run.cwd, 'STANDING.md'), 'Wrong instruction source.');
    const native = fakeVendor((launch) => {
      const contract = fs.readFileSync(launch.seatContractPath, 'utf8');
      const briefDir = path.dirname(launch.briefPath);
      const rulesDir = path.join(briefDir, 'RULES');
      const files = ['STANDING.md', 'VENDOR.md', 'RULES/INDEX.md', 'rules-manifest.json'].map(name => path.join(briefDir, name));
      files.push(path.join(launch.skillRoot, 'skills-manifest.json'));
      for (const file of files) {
        assert.equal(path.isAbsolute(file), true);
        assert.equal(fs.statSync(file).isFile(), true);
        assert.ok(contract.includes(file), `missing staged instruction path: ${file}`);
      }
      const indexed = fs.readFileSync(path.join(rulesDir, 'INDEX.md'), 'utf8').trim().split(/\r?\n/);
      assert.equal(indexed.length, 22);
      for (const file of indexed) assert.equal(fs.statSync(path.join(rulesDir, file)).isFile(), true);
      const manifest = JSON.parse(fs.readFileSync(path.join(launch.skillRoot, 'skills-manifest.json'), 'utf8'));
      for (const skill of Object.keys(manifest.skills)) {
        const file = path.join(launch.skillRoot, skill, 'SKILL.md');
        assert.equal(fs.statSync(file).isFile(), true);
        assert.ok(contract.includes(file), `missing required skill path: ${file}`);
      }
      assert.match(contract, /Read every indexed rule file, including all R01-R22 rules, in full before task work/);
      assert.match(contract, /Required staged skills: read every listed SKILL\.md in full before task work/);
      assert.match(contract, /missing or unreadable.*stop task work and report a blocker/);
      assert.match(contract, /Never waive a required read/);
      assert.ok(contract.includes(`staged brief directory: ${briefDir}`));
      assert.ok(contract.includes(`staged rule directory: ${rulesDir}`));
      assert.match(contract, /Do not resolve instruction paths against the product working directory/);
      assert.ok(contract.includes(`Resolve task and product paths against the assigned worktree unless the brief specifies otherwise: ${launch.cwd}`));
      assert.match(contract, /Read-only role: do not modify product files/);
      if (route.vendor === 'openai') {
        assert.match(contract, /Disposable test files are authorized only under/);
        assert.match(contract, /TEMP and TMP point there/);
      }
    });
    const result = await runDispatch({ ...run.opts, dispatchId: 'd1' }, native);
    assert.equal(result.status === 'AWAITING_ATTESTATION' || result.ok, true);
    assert.equal(native.calls(), 1);
  });
}

test('naked route and ad hoc escalation cannot launch', async () => {
  await assert.rejects(runDispatch({ vendor: 'openai', model: 'gpt-6-astra' }), /--plan and --dispatch-id/);
  assert.throws(() => parseArgs(['--escalation', 'true']), /unknown option/);
});

test('workspace denial precedes transaction reservation and an explicit root permits the untouched run', async (t) => {
  const run = createSealedRun(t); const native = fakeVendor(); const opts = { ...run.opts, dispatchId: 'd1' };
  const denied = { ...process.env, MAGI_DEV_ROOT: path.join(run.root, 'different-root'), MAGI_ALLOWED_WORKSPACE_ROOTS: '' };
  await assert.rejects(runDispatch(opts, { ...native, env: denied }), { code: 'WORKSPACE_FORBIDDEN' });
  assert.equal(native.calls(), 0);
  assert.equal(fs.existsSync(path.join(run.runDir, 'out', 'd1')), false);
  assert.equal(fs.existsSync(path.join(run.runDir, '.magi-dispatches')), false);
  const result = await runDispatch(opts, { ...native, env: { ...denied, MAGI_ALLOWED_WORKSPACE_ROOTS: run.root } });
  assert.equal(result.ok, true); assert.equal(native.calls(), 1);
});

test('sealed launch binds route and rejects every changed identity before spawn', async (t) => {
  const run = createSealedRun(t);
  const native = fakeVendor();
  for (const [field, value] of Object.entries({ vendor: 'google', model: 'gpt-5.6-sol', effort: 'high', class: 'debug-mystery', unitId: 'other', authorVendor: 'anthropic', escalation: true })) {
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1', [field]: value }, native), /differs from validated plan/);
  }
  assert.equal(native.calls(), 0);
});

test('changed plan bytes, policy and brief fail before launch', async (t) => {
  const run = createSealedRun(t);
  const native = fakeVendor();
  fs.appendFileSync(run.dispatches[0].brief, 'Changed task');
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /brief differs/);
  fs.appendFileSync(run.opts.plan, '\n');
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /sealed run inputs changed/);
  assert.equal(native.calls(), 0);
});

test('valid launch records scope and native evidence; retry returns the same transaction once', async (t) => {
  const run = createSealedRun(t);
  const native = fakeVendor((launch) => fs.writeFileSync(path.join(launch.cwd, 'result.txt'), 'implemented'));
  const opts = { ...run.opts, dispatchId: 'd1' };
  const first = await runDispatch(opts, native);
  assert.equal(first.receipt.changedFiles[0].path, 'result.txt');
  assert.equal(first.receipt.modelObserved, 'gpt-5.6-terra');
  assert.equal(first.receipt.planHash, run.sealed.planHash);
  const replay = await runDispatch(opts, native);
  assert.equal(replay.replayed, true); assert.equal(replay.proofId, first.proofId); assert.equal(native.calls(), 1);
  const final = finalizeRun(run.runDir);
  assert.equal(final.executionStatus, 'PASS'); assert.equal(final.approvalStatus, 'FAIL');
  const rows = fs.readFileSync(path.join(run.runDir, 'telemetry.jsonl'), 'utf8').trim().split('\n');
  assert.equal(rows.length, 1);
  fs.appendFileSync(path.join(run.runDir, 'out/d1/capture.txt'), 'tamper');
  await assert.rejects(runDispatch(opts, native), /committed evidence changed/);
});

test('completed non-Claude replays use launch-time probes while unstarted work still needs fresh probes', async t => {
  for (const entry of [{}, { role: 'review', class: 'review-adversarial', vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high', authorVendor: 'openai' }]) {
    const run = createSealedRun(t, [entry]); const unstarted = createSealedRun(t, [entry]);
    const native = fakeVendor(); const noChild = fakeVendor(); const opts = { ...run.opts, dispatchId: 'd1' };
    const first = await runDispatch(opts, native);
    const now = Date.now; const future = now() + 61 * 60 * 1000;
    Date.now = () => future;
    try {
      const replay = await runDispatch(opts, native);
      assert.equal(replay.replayed, true); assert.equal(replay.proofId, first.proofId);
      await assert.rejects(runDispatch({ ...unstarted.opts, dispatchId: 'd1' }, noChild), /stale|availability/);
      fs.appendFileSync(path.join(run.runDir, 'out/d1/capture.txt'), 'tamper');
      await assert.rejects(runDispatch(opts, native), /committed evidence changed/);
    } finally { Date.now = now; }
    assert.equal(native.calls(), 1); assert.equal(noChild.calls(), 0);
  }
});

test('unconfirmed child termination records an incomplete workspace audit and blocks the dispatch', async t => {
  const run = createSealedRun(t); const native = fakeVendor();
  native.runLaunch = async () => { throw Object.assign(new Error('child exit was not confirmed after termination'), { code: 'CHILD_EXIT_UNCONFIRMED', pid: 4123, exitConfirmed: false }); };
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), { code: 'CHILD_EXIT_UNCONFIRMED' });
  const failure = JSON.parse(fs.readFileSync(path.join(run.runDir, 'out/d1/receipt-ack.json')));
  assert.equal(failure.status, 'FAIL'); assert.equal(failure.scopeAudit.incomplete, true);
  assert.equal(failure.scopeAudit.exitConfirmed, false); assert.equal(failure.scopeAudit.childPid, 4123);
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /logical dispatch is FAIL/);
});

test('read-only or out-of-scope writes fail and cannot produce successful telemetry', async (t) => {
  for (const entry of [{}, { role: 'verify', class: 'test-verification', authorVendor: 'anthropic' }]) {
    const run = createSealedRun(t, [entry]);
    const native = fakeVendor((launch) => fs.writeFileSync(path.join(launch.cwd, 'forbidden.txt'), 'bad'));
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), { code: 'SCOPE_FAIL' });
    assert.equal(inspectRun(run.runDir).outcomes[0].status, 'FAIL');
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), { code: 'DUPLICATE_DISPATCH' });
    assert.equal(native.calls(), 1);
    assert.equal(fs.existsSync(path.join(run.runDir, 'telemetry/dispatches.jsonl')), false);
  }
});

test('nonzero child, missing capture and malformed proof produce terminal failures', async (t) => {
  for (const failure of ['exit', 'capture', 'proof']) {
    const run = createSealedRun(t);
    const native = fakeVendor();
    const launch = native.runLaunch;
    native.runLaunch = async (spec) => {
      const result = await launch(spec);
      if (failure === 'exit') return { ...result, ok: false, exitCode: 1 };
      if (failure === 'capture') fs.unlinkSync(spec.capturePath);
      if (failure === 'proof') result.stderr = 'requested gpt-5.6-terra';
      return result;
    };
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /failed|capture|proof/i);
    assert.equal(inspectRun(run.runDir).outcomes[0].status, 'FAIL');
  }
});

test('post-launch skill/rule additions and manifest rewrites invalidate transaction', async (t) => {
  for (const target of ['rules', 'skills']) {
    const run = createSealedRun(t);
    const native = fakeVendor((launch) => {
      const root = target === 'rules' ? path.join(path.dirname(launch.briefPath), 'RULES') : launch.skillRoot;
      fs.writeFileSync(path.join(root, 'injected.md'), 'bad');
    });
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /unexpected|differs|mismatch|inventory/);
    assert.equal(inspectRun(run.runDir).outcomes[0].status, 'FAIL');
  }
});

test('availability cannot forge an exact model from a handwritten observation', async (t) => {
  const run = createSealedRun(t);
  run.available.vendors.openai.models['gpt-5.6-terra'].efforts.medium.evidence.sha256 = 'a'.repeat(64);
  writeJson(run.availability, run.available);
  const native = fakeVendor();
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1', availability: run.availability }, native), /availability override differs from sealed evidence/);
  assert.equal(native.calls(), 0);
});

test('availability override cannot replace genuine sealed probes; identical relocation is allowed', async (t) => {
  const run = createSealedRun(t);
  const replacement = createSealedRun(t);
  const native = fakeVendor();
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1', availability: replacement.availability }, native), /availability override differs from sealed evidence/);
  assert.equal(native.calls(), 0);
  const relocated = path.join(run.root, 'relocated-availability.json');
  fs.copyFileSync(path.join(run.runDir, 'availability.json'), relocated);
  const result = await runDispatch({ ...run.opts, dispatchId: 'd1', availability: relocated }, native);
  assert.equal(result.ok, true);
  assert.equal(native.calls(), 1);
});

test('no-op implementation does not manufacture an implementation unit', async (t) => {
  const run = createSealedRun(t);
  const native = fakeVendor((launch) => fs.unlinkSync(path.join(launch.cwd, 'result.txt')));
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /no covered file change/);
  assert.equal(inspectRun(run.runDir).outcomes[0].status, 'FAIL');
});

test('Git config edits, source rules/skills edits and hard-link scope escape all fail', async (t) => {
  for (const kind of ['git-config', 'source-rules', 'source-skills', 'hard-link']) {
    const run = createSealedRun(t);
    if (kind === 'git-config') require('node:child_process').execFileSync('git', ['init', run.cwd], { stdio: 'pipe' });
    const native = fakeVendor((launch) => {
      if (kind === 'git-config') fs.appendFileSync(path.join(run.cwd, '.git/config'), '\n[core]\n editor = injected\n');
      if (kind === 'source-rules') fs.appendFileSync(path.join(run.opts.rulesRoot, 'STANDING.md'), '\nInjected instruction');
      if (kind === 'source-skills') fs.appendFileSync(path.join(run.opts.skillSourceRoot, 'implement/SKILL.md'), '\nInjected instruction');
      if (kind === 'hard-link') {
        fs.unlinkSync(path.join(launch.cwd, 'result.txt'));
        const outside = path.join(run.root, 'outside.txt'); fs.writeFileSync(outside, 'outside');
        fs.linkSync(outside, path.join(launch.cwd, 'result.txt')); fs.writeFileSync(path.join(launch.cwd, 'result.txt'), 'changed outside');
      }
    });
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /git state|rules source|skill source|hard links/);
    assert.equal(inspectRun(run.runDir).outcomes[0].status, 'FAIL');
  }
});

test('an evidence junction cannot redirect wrapper writes into product files', async (t) => {
  const run = createSealedRun(t);
  const target = path.join(run.cwd, 'unscoped'); fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(run.runDir, 'telemetry'), process.platform === 'win32' ? 'junction' : 'dir');
  const native = fakeVendor();
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, native), /junctions/);
  assert.equal(native.calls(), 0); assert.equal(fs.readdirSync(target).length, 0);
});

test('authorized Astra escalation appears in launch, proof, telemetry and receipt', async (t) => {
  const reason = 'Ordinary model could not resolve architectural ambiguity';
  const run = createSealedRun(t, [{ role: 'research', class: 'long-context-analysis', model: 'gpt-6-astra', effort: 'high', escalation: true, escalationReason: reason }]);
  const result = await runDispatch({ ...run.opts, dispatchId: 'd1' }, fakeVendor());
  for (const row of [result.receipt, result.telemetry, JSON.parse(fs.readFileSync(path.join(run.runDir, 'out/d1/launch.json'))), JSON.parse(fs.readFileSync(path.join(run.runDir, 'out/d1/proof.json')))]) {
    assert.equal(row.escalation, true); assert.equal(row.escalationReason, reason);
  }
});

test('an aborted vendor child fails the transaction instead of leaving it RUNNING', async (t) => {
  const run = createSealedRun(t);
  const controller = new AbortController();
  const native = fakeVendor();
  native.runLaunch = async () => {
    controller.abort();
    return { ok: false, exitCode: 1, killed: true, killReason: 'cancelled', stdout: '', stderr: '', exitConfirmed: true };
  };
  await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, { ...native, signal: controller.signal }), /vendor child failed/);
  assert.equal(inspectRun(run.runDir).outcomes[0].status, 'FAIL');
});

// A host death does not execute runDispatch's catch block. Leave its synthetic
// promise unresolved, just as an abruptly terminated host leaves RUNNING on disk.
async function interruptedReview(t, entries) {
  const { transactionKey } = require('./dispatch-evidence.js');
  const run = createSealedRun(t, entries || [{ role: 'review', class: 'review-adversarial', model: 'gpt-5.6-sol', effort: 'high', authorVendor: 'google' }]);
  const id = run.dispatches.at(-1).dispatchId;
  const native = fakeVendor();
  for (const entry of run.dispatches.slice(0, -1)) await require('./test-fixtures.js').completeSyntheticDispatch({ ...run.opts, dispatchId: entry.dispatchId }, native);
  native.buildLaunch = opts => ({ ...opts, ...require('./cli-adapters.js').openaiLaunch({ ...opts, env: { ...native.env, MAGI_CODEX_BIN: process.execPath } }) });
  let launched;
  const ready = new Promise(resolve => { launched = resolve; });
  const sessionId = '20000000-0000-4000-8000-000000000001';
  const transcriptPath = path.join(run.root, 'interrupted-native.jsonl');
  fs.writeFileSync(transcriptPath, JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cwd: run.cwd } }) + '\n');
  native.runLaunch = async (launch, options) => {
    fs.writeFileSync(options.pidFile, '123456789\n');
    fs.writeFileSync(options.stderrFile, `OpenAI Codex v0.153.4\nmodel: ${launch.model}\nsandbox: custom permissions\nreasoning effort: ${launch.effort}\nsession id: ${sessionId}\nuser\nPending task\n`);
    launched();
    return new Promise(() => {});
  };
  runDispatch({ ...run.opts, dispatchId: id }, native).catch(launched);
  await ready;
  const deps = { ...fakeVendor(), assertInterruptedChildStopped: () => ({ pid: 123456789, status: 'ABSENT' }),
    codexSessionTranscript: () => ({ path: transcriptPath, text: fs.readFileSync(transcriptPath, 'utf8') }) };
  const request = path.join(run.root, 'recovery-request.json');
  const opts = { ...run.opts, dispatchId: id, availability: run.availability };
  const originalFile = path.join(run.runDir, '.magi-dispatches', `${transactionKey(run.dispatches.at(-1))}.json`);
  return { run, opts, deps, request, originalFile, transcriptPath };
}

async function failedRecovery(t, entries) {
  const f = await interruptedReview(t, entries);
  const prepared = await runDispatch({ ...f.opts, prepareRecovery: f.request }, f.deps);
  const native = fakeVendor(() => {}, 'Cannot read instructions.');
  native.buildLaunch = opts => ({ ...opts, ...require('./cli-adapters.js').openaiLaunch({ ...opts, env: { ...native.env, MAGI_CODEX_BIN: process.execPath } }) });
  const collect = native.codexSessionTranscript;
  native.codexSessionTranscript = id => {
    const transcript = collect(id);
    const rows = [{ type: 'session_meta', payload: { id, cwd: f.run.cwd } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final', content: [{ type: 'output_text', text: 'Cannot read instructions.' }] } },
      { type: 'event_msg', payload: { type: 'task_complete' } }];
    transcript.text = rows.map(JSON.stringify).join('\n') + '\n';
    fs.writeFileSync(transcript.path, transcript.text);
    return transcript;
  };
  const launch = native.runLaunch;
  native.runLaunch = async (spec, options) => { fs.writeFileSync(options.pidFile, '123456789\n'); return launch(spec, options); };
  await assert.rejects(runDispatch({ ...f.opts, recoverInterrupted: f.request, recoverySha256: prepared.recoverySha256 },
    { ...f.deps, ...native, assertInterruptedChildStopped: f.deps.assertInterruptedChildStopped }), /instruction|read/i);
  f.first = require('./dispatch-evidence.js').recoveryPaths(f.run.runDir, f.run.dispatches.at(-1));
  f.secondRequest = path.join(f.run.root, 'recovery-request-2.json');
  f.firstRequestSha256 = prepared.recoverySha256;
  const observed = require('./test-fixtures.js').probeRecord(path.join(f.run.root, 'retry-probes'), 'openai', 'gpt-5.6-sol', 'high');
  f.opts.availability = path.join(f.run.root, 'retry-availability.json');
  writeJson(f.opts.availability, { vendors: { openai: { models: { 'gpt-5.6-sol': { efforts: { high: observed } } } } } });
  return f;
}

test('explicit second recovery prepares after a completed clean failed predecessor', async t => {
  const f = await failedRecovery(t);
  const prepared = await runDispatch({ ...f.opts, prepareRecovery: f.secondRequest, recoveryAttempt: '2' }, f.deps);
  assert.equal(prepared.status, 'RECOVERY_PREPARED');
  const manifest = JSON.parse(fs.readFileSync(f.secondRequest));
  assert.equal(manifest.attempt, 2);
  assert.equal(manifest.previousAttempt.failureCode, 'INSTRUCTION_READ_FAIL');
  const evidence = require('./dispatch-evidence.js');
  const original = fs.readFileSync(f.originalFile);
  const first = evidence.snapshotWorkspace(f.first.root);
  const native = fakeVendor();
  const options = { ...f.opts, recoverInterrupted: f.secondRequest, recoverySha256: prepared.recoverySha256 };
  const result = await runDispatch(options, { ...f.deps, ...native, assertInterruptedChildStopped: f.deps.assertInterruptedChildStopped });
  assert.equal(result.ok, true); assert.equal(native.calls(), 1);
  assert.deepEqual(fs.readFileSync(f.originalFile), original);
  assert.deepEqual(evidence.snapshotWorkspace(f.first.root), first);
  const inspected = inspectRun(f.run.runDir);
  assert.equal(inspected.outcomes[0].status, 'PASS'); assert.equal(inspected.executions.length, 1);
  assert.equal(inspected.outcomes[0].failedRecoveryAttempt.failureCode, 'INSTRUCTION_READ_FAIL');
  await assert.rejects(runDispatch({ ...f.opts, recoverInterrupted: f.request, recoverySha256: f.firstRequestSha256 }, native), /do not relaunch/);
  await assert.rejects(runDispatch({ ...f.run.opts, dispatchId: 'd1' }, native), /RUNNING/);
  const now = Date.now;
  Date.now = () => now() + 2 * 60 * 60 * 1000;
  try { assert.equal((await runDispatch(options, native)).replayed, true); }
  finally { Date.now = now; }
  assert.equal(native.calls(), 1);
});

test('second recovery rejects ineligible predecessor states and incomplete native completion', async t => {
  for (const fault of ['RUNNING', 'PASS', 'unknown', 'incomplete', 'bad-scope', 'no-terminal', 'no-final', 'no-native', 'bad-lineage', 'old-probe', 'wrong-route', 'live', 'unknown-child']) {
    const f = await failedRecovery(t);
    const state = JSON.parse(fs.readFileSync(f.first.transactionPath));
    if (['RUNNING', 'PASS', 'unknown'].includes(fault)) state.status = fault;
    if (fault === 'incomplete') state.scopeAudit.exitConfirmed = false;
    if (fault === 'bad-scope') state.scopeAudit.ok = false;
    if (fault === 'bad-lineage') state.recoverySha256 = '0'.repeat(64);
    if (['RUNNING', 'PASS', 'unknown', 'incomplete', 'bad-scope', 'bad-lineage'].includes(fault)) writeJson(f.first.transactionPath, state);
    if (fault.startsWith('no-')) {
      const bindingPath = path.join(state.evidenceDir, 'instruction-transcript.json');
      const binding = JSON.parse(fs.readFileSync(bindingPath));
      if (fault === 'no-native') fs.unlinkSync(binding.sourcePath);
      else {
        const rows = fs.readFileSync(binding.sourcePath, 'utf8').trim().split('\n').map(JSON.parse)
          .filter(row => fault === 'no-terminal' ? row.type !== 'event_msg' : row.type !== 'response_item');
        const text = rows.map(JSON.stringify).join('\n') + '\n';
        fs.writeFileSync(binding.sourcePath, text); fs.writeFileSync(path.join(state.evidenceDir, 'native-instructions.jsonl'), text);
        binding.sha256 = require('./dispatch-evidence.js').hash(text); writeJson(bindingPath, binding);
      }
    }
    if (fault === 'old-probe') f.opts.availability = f.run.availability;
    if (fault === 'wrong-route') {
      const observed = require('./test-fixtures.js').probeRecord(path.join(f.run.root, 'wrong-route'), 'openai', 'gpt-5.6-sol', 'medium');
      writeJson(f.opts.availability, { vendors: { openai: { models: { 'gpt-5.6-sol': observed } } } });
    }
    if (fault === 'live' || fault === 'unknown-child') f.deps.assertInterruptedChildStopped = (_pid, _launch, dir) => {
      if (dir === state.evidenceDir) throw new Error(fault);
      return { pid: 123456789, status: 'ABSENT' };
    };
    await assert.rejects(runDispatch({ ...f.opts, prepareRecovery: f.secondRequest, recoveryAttempt: 2 }, f.deps), undefined, fault);
    assert.equal(f.deps.calls(), 0, fault);
  }
});

test('second recovery rechecks frozen lineage, process absence and probe before launch', async t => {
  for (const fault of ['original', 'predecessor', 'first-manifest', 'first-native', 'product', 'instruction', 'request', 'probe', 'stale', 'live', 'unknown', 'late-live', 'staged-manifest', 'duplicate', 'extra-directory']) {
    const f = await failedRecovery(t);
    const prepared = await runDispatch({ ...f.opts, prepareRecovery: f.secondRequest, recoveryAttempt: 2 }, f.deps);
    const manifest = JSON.parse(fs.readFileSync(f.secondRequest));
    const files = { original: f.originalFile, predecessor: f.first.transactionPath, 'first-manifest': f.first.manifestPath,
      'first-native': manifest.previousAttempt.native.path, product: path.join(f.run.cwd, 'drift.txt'), instruction: path.join(f.run.opts.rulesRoot, 'STANDING.md'), request: f.secondRequest, probe: f.opts.availability };
    if (files[fault]) fs.appendFileSync(files[fault], '\n');
    if (fault === 'live' || fault === 'unknown') f.deps.assertInterruptedChildStopped = (_pid, _launch, dir) => {
      if (dir === manifest.previousAttempt.evidenceDir) throw new Error(fault);
      return { pid: 123456789, status: 'ABSENT' };
    };
    if (fault === 'late-live') {
      let checked = 0;
      f.deps.assertInterruptedChildStopped = (_pid, _launch, dir) => {
        if (dir === manifest.previousAttempt.evidenceDir && ++checked > 1) throw new Error('predecessor became live before launch');
        return { pid: 123456789, status: 'ABSENT' };
      };
    }
    if (fault === 'staged-manifest') {
      const build = f.deps.buildLaunch;
      f.deps.buildLaunch = spec => {
        fs.appendFileSync(path.join(path.dirname(manifest.transactionPath), 'recovery.json'), '\n');
        return build(spec);
      };
    }
    if (fault === 'duplicate') fs.mkdirSync(path.dirname(manifest.transactionPath));
    if (fault === 'extra-directory') fs.mkdirSync(f.first.root + '.3');
    const now = Date.now;
    if (fault === 'stale') Date.now = () => now() + 2 * 60 * 60 * 1000;
    try { await assert.rejects(runDispatch({ ...f.opts, recoverInterrupted: f.secondRequest, recoverySha256: prepared.recoverySha256 }, f.deps), undefined, fault); }
    finally { Date.now = now; }
    assert.equal(f.deps.calls(), 0, fault);
  }
});

test('recovery ordinal is explicit, bounded, and prepare-only', async t => {
  const f = await interruptedReview(t);
  const { recoveryPaths } = require('./dispatch-evidence.js');
  for (const attempt of [0, 3, -1, '2']) assert.throws(() => recoveryPaths(f.run.runDir, f.run.dispatches[0], attempt));
  for (const recoveryAttempt of ['0', '3', '2.0', 'bogus']) {
    await assert.rejects(runDispatch({ ...f.opts, prepareRecovery: f.request, recoveryAttempt }, f.deps), /ordinal 1 or 2/);
  }
  await assert.rejects(runDispatch({ ...f.opts, recoveryAttempt: 2 }, f.deps), /requires prepare-recovery/);
  await assert.rejects(runDispatch({ ...f.opts, prepareRecovery: f.request, recoveryAttempt: 2 }, f.deps), /valid first recovery lineage/);
  assert.equal(f.deps.calls(), 0);
});

test('second recovery forbids both earlier native IDs and a concurrent second launch', async t => {
  for (const previous of ['original', 'previousAttempt']) {
    const f = await failedRecovery(t);
    const prepared = await runDispatch({ ...f.opts, prepareRecovery: f.secondRequest, recoveryAttempt: 2 }, f.deps);
    const manifest = JSON.parse(fs.readFileSync(f.secondRequest));
    const native = fakeVendor(); const launch = native.runLaunch;
    native.runLaunch = async spec => {
      const result = await launch(spec);
      result.stderr = result.stderr.replace(/^session id: .*$/m, `session id: ${manifest[previous].native.sessionId}`);
      return result;
    };
    await assert.rejects(runDispatch({ ...f.opts, recoverInterrupted: f.secondRequest, recoverySha256: prepared.recoverySha256 },
      { ...f.deps, ...native, assertInterruptedChildStopped: f.deps.assertInterruptedChildStopped }), /reused an earlier native session/);
    assert.equal(native.calls(), 1);
  }
  const f = await failedRecovery(t);
  const prepared = await runDispatch({ ...f.opts, prepareRecovery: f.secondRequest, recoveryAttempt: 2 }, f.deps);
  const opts = { ...f.opts, recoverInterrupted: f.secondRequest, recoverySha256: prepared.recoverySha256 };
  const native = fakeVendor(); const launch = native.runLaunch;
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  native.runLaunch = async spec => { entered(); await pending; return launch(spec); };
  const running = runDispatch(opts, { ...f.deps, ...native, assertInterruptedChildStopped: f.deps.assertInterruptedChildStopped });
  await ready;
  await assert.rejects(runDispatch(opts, native), /do not relaunch/);
  release(); assert.equal((await running).ok, true); assert.equal(native.calls(), 1);
});

test('second recovery direct CLI finalization and activation retain six logical entries and reject missing lineage', async t => {
  const f = await failedRecovery(t, [
    ...Array.from({ length: 3 }, () => ({ role: 'plan', class: 'architecture-planning', model: 'gpt-5.6-sol', effort: 'high' })),
    { unitId: 'product', vendor: 'google', model: 'gemini-3.8-flash-medium', effort: 'fused-medium' },
    { unitId: 'product', role: 'verify', class: 'test-verification', vendor: 'anthropic', model: 'sonnet', effort: 'medium', authorVendor: 'google' },
    { unitId: 'product', role: 'review', class: 'review-adversarial', model: 'gpt-5.6-sol', effort: 'high', authorVendor: 'google' },
  ]);
  const evidence = require('./dispatch-evidence.js');
  const originals = evidence.snapshotWorkspace(path.join(f.run.runDir, '.magi-dispatches'));
  const originalOutput = evidence.snapshotWorkspace(path.join(f.run.runDir, 'out'));
  const first = evidence.snapshotWorkspace(f.first.root);
  const prepared = await runDispatch({ ...f.opts, prepareRecovery: f.secondRequest, recoveryAttempt: 2 }, f.deps);
  await runDispatch({ ...f.opts, recoverInterrupted: f.secondRequest, recoverySha256: prepared.recoverySha256 },
    { ...f.deps, ...fakeVendor(), assertInterruptedChildStopped: f.deps.assertInterruptedChildStopped });
  const cli = require('node:child_process').spawnSync(process.execPath,
    [path.join(__dirname, 'run-finalize.js'), '--run-dir', f.run.runDir],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, MAGI_VAULT_LINK: '0' } });
  assert.equal(cli.status, 0, `${cli.stderr}\n${cli.stdout}`);
  assert.equal(cli.stderr, '');
  const final = JSON.parse(cli.stdout);
  assert.equal(final.ok, true); assert.equal(final.outcomes.length, 6); assert.equal(inspectRun(f.run.runDir).executions.length, 6);
  assert.deepEqual(evidence.snapshotWorkspace(path.join(f.run.runDir, '.magi-dispatches')), originals);
  assert.deepEqual(evidence.snapshotWorkspace(path.join(f.run.runDir, 'out')), originalOutput);
  assert.deepEqual(evidence.snapshotWorkspace(f.first.root), first);
  const activation = () => require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'activation-check.js'), path.join(f.run.runDir, 'magi-dispatch-log.jsonl')], { encoding: 'utf8', windowsHide: true });
  assert.equal(activation().status, 0);
  const saved = fs.readFileSync(f.first.manifestPath); fs.unlinkSync(f.first.manifestPath);
  assert.equal(inspectRun(f.run.runDir).outcomes.at(-1).status, 'INVALID'); assert.notEqual(activation().status, 0);
  fs.writeFileSync(f.first.manifestPath, saved);
  const second = evidence.recoveryPaths(f.run.runDir, f.run.dispatches.at(-1), 2);
  const state = JSON.parse(fs.readFileSync(second.transactionPath)); state.recoverySha256 = 'f'.repeat(64); writeJson(second.transactionPath, state);
  assert.equal(inspectRun(f.run.runDir).outcomes.at(-1).status, 'INVALID'); assert.notEqual(activation().status, 0);
});

test('interrupted read-only recovery preserves the first attempt and credits one fresh replacement', async t => {
  const f = await interruptedReview(t);
  const original = fs.readFileSync(f.originalFile);
  const before = require('./dispatch-evidence.js').snapshotWorkspace(path.join(f.run.runDir, 'out/d1'));
  const prepared = await runDispatch({ ...f.opts, prepareRecovery: f.request }, f.deps);
  assert.equal(prepared.status, 'RECOVERY_PREPARED'); assert.equal(f.deps.calls(), 0);
  f.opts.recoverySha256 = prepared.recoverySha256;
  const native = fakeVendor();
  native.buildLaunch = opts => ({ ...opts, ...require('./cli-adapters.js').openaiLaunch({ ...opts, env: { ...native.env, MAGI_CODEX_BIN: process.execPath } }) });
  const result = await runDispatch({ ...f.opts, recoverInterrupted: f.request }, { ...f.deps, ...native, assertInterruptedChildStopped: f.deps.assertInterruptedChildStopped });
  assert.equal(result.ok, true); assert.equal(native.calls(), 1);
  assert.deepEqual(fs.readFileSync(f.originalFile), original);
  assert.deepEqual(require('./dispatch-evidence.js').snapshotWorkspace(path.join(f.run.runDir, 'out/d1')), before);
  const inspected = inspectRun(f.run.runDir);
  assert.equal(inspected.outcomes[0].status, 'PASS'); assert.equal(inspected.executions.length, 1);
  assert.equal(inspected.outcomes[0].interruptedAttempt.status, 'RUNNING');
  assert.equal(inspected.executions[0].proof.sandbox, 'custom permissions');
  assert.ok(inspected.executions[0].proof.scratchPermissions.scratchPath.includes('.magi-recoveries'));
  const replay = await runDispatch({ ...f.opts, recoverInterrupted: f.request }, native);
  assert.equal(replay.replayed, true); assert.equal(native.calls(), 1);
  await assert.rejects(runDispatch({ ...f.opts, recoverInterrupted: f.request, model: 'gpt-6-astra' }, native), /differs from validated plan/);
  fs.appendFileSync(f.transcriptPath, '\n');
  assert.equal(inspectRun(f.run.runDir).outcomes[0].status, 'INVALID');
});

test('interrupted recovery rejects liveness uncertainty, drift, completed output, stale probes and duplicate attempts', async t => {
  for (const fault of ['live', 'unknown', 'workspace', 'input', 'terminal', 'final', 'final_answer', 'missing-pid', 'stale', 'manifest', 'duplicate']) {
    const f = await interruptedReview(t);
    const prepared = await runDispatch({ ...f.opts, prepareRecovery: f.request }, f.deps);
    f.opts.recoverySha256 = prepared.recoverySha256;
    if (fault === 'live' || fault === 'unknown') f.deps.assertInterruptedChildStopped = () => { throw new Error(`${fault} child`); };
    if (fault === 'workspace') fs.writeFileSync(path.join(f.run.cwd, 'drift.txt'), 'drift');
    if (fault === 'input') fs.appendFileSync(f.run.dispatches[0].brief, 'drift');
    if (fault === 'terminal') fs.writeFileSync(path.join(f.run.runDir, 'out/d1/capture.txt'), 'completed');
    if (fault === 'final' || fault === 'final_answer') fs.appendFileSync(f.transcriptPath, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', phase: fault, content: [{ type: 'output_text', text: 'Completed reply' }] } }) + '\n');
    if (fault === 'missing-pid') fs.unlinkSync(path.join(f.run.runDir, 'out/d1/child.pid'));
    if (fault === 'manifest') { const request = JSON.parse(fs.readFileSync(f.request)); request.entry.model = 'gpt-6-astra'; writeJson(f.request, request); }
    if (fault === 'duplicate') { const request = JSON.parse(fs.readFileSync(f.request)); fs.mkdirSync(request.attemptRoot, { recursive: true }); }
    const now = Date.now;
    if (fault === 'stale') Date.now = () => now() + 61 * 60 * 1000;
    try { await assert.rejects(runDispatch({ ...f.opts, recoverInterrupted: f.request }, f.deps)); }
    finally { Date.now = now; }
    assert.equal(f.deps.calls(), 0, fault);
    assert.equal(JSON.parse(fs.readFileSync(f.originalFile)).status, 'RUNNING');
  }
});

test('recovery binds fresh target-only availability and leaves five committed prerequisites unchanged', async t => {
  const f = await interruptedReview(t, [
    ...Array.from({ length: 3 }, () => ({ role: 'plan', class: 'architecture-planning', model: 'gpt-5.6-sol', effort: 'high' })),
    { unitId: 'product', vendor: 'google', model: 'gemini-3.8-flash-medium', effort: 'fused-medium' },
    { unitId: 'product', role: 'verify', class: 'test-verification', vendor: 'anthropic', model: 'sonnet', effort: 'medium', authorVendor: 'google' },
    { unitId: 'product', role: 'review', class: 'review-adversarial', model: 'gpt-5.6-sol', effort: 'high', authorVendor: 'google' },
  ]);
  const evidence = require('./dispatch-evidence.js');
  const before = f.run.dispatches.slice(0, -1).map(entry => ({
    file: path.join(f.run.runDir, '.magi-dispatches', `${evidence.transactionKey(entry)}.json`),
    out: path.join(f.run.runDir, 'out', entry.dispatchId),
  })).map(item => ({ ...item, sha256: hashFile(item.file), snapshot: evidence.snapshotWorkspace(item.out) }));
  const single = path.join(f.run.root, 'fresh-sol-only.json');
  writeJson(single, { vendors: { openai: { models: { 'gpt-5.6-sol': f.run.available.vendors.openai.models['gpt-5.6-sol'] } } } });
  f.opts.availability = single;
  const prepared = await runDispatch({ ...f.opts, prepareRecovery: f.request }, f.deps);
  f.opts.recoverySha256 = prepared.recoverySha256;
  // The reviewed prerequisite is immutable across the preparation/launch edge.
  const prior = fs.readFileSync(before[0].file);
  fs.appendFileSync(before[0].file, '\n');
  await assert.rejects(runDispatch({ ...f.opts, recoverInterrupted: f.request }, f.deps), /recovery frozen original evidence/);
  fs.writeFileSync(before[0].file, prior);
  const native = fakeVendor();
  const result = await runDispatch({ ...f.opts, recoverInterrupted: f.request }, { ...f.deps, ...native, assertInterruptedChildStopped: f.deps.assertInterruptedChildStopped });
  assert.equal(result.ok, true); assert.equal(native.calls(), 1);
  const final = finalizeRun(f.run.runDir);
  assert.equal(final.ok, true); assert.equal(final.outcomes.length, 6);
  assert.equal(inspectRun(f.run.runDir).executions.length, 6);
  const activation = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'activation-check.js'), path.join(f.run.runDir, 'magi-dispatch-log.jsonl')], { encoding: 'utf8', windowsHide: true });
  assert.equal(activation.status, 0, activation.stderr);
  for (const item of before) { assert.equal(hashFile(item.file), item.sha256); assert.deepEqual(evidence.snapshotWorkspace(item.out), item.snapshot); }
  assert.equal(JSON.parse(fs.readFileSync(f.originalFile)).status, 'RUNNING');
});

test('recovery refuses implementation and live processes without launch; terminal replacement cannot relaunch', async t => {
  const { assertInterruptedChildStopped, recoveryPaths } = require('./dispatch-evidence.js');
  assert.throws(() => assertInterruptedChildStopped(process.pid, { binary: process.execPath }, process.cwd()), /live|unknown/);
  const implement = createSealedRun(t);
  await assert.rejects(runDispatch({ ...implement.opts, dispatchId: 'd1', availability: implement.availability,
    prepareRecovery: path.join(implement.root, 'request.json') }, fakeVendor()), /only OpenAI read-only/);
  const f = await interruptedReview(t);
  const prepared = await runDispatch({ ...f.opts, prepareRecovery: f.request }, f.deps);
  f.opts.recoverySha256 = prepared.recoverySha256;
  const native = fakeVendor(launch => fs.writeFileSync(path.join(launch.cwd, 'unscoped.txt'), 'forbidden'));
  await assert.rejects(runDispatch({ ...f.opts, recoverInterrupted: f.request }, { ...f.deps, ...native, assertInterruptedChildStopped: f.deps.assertInterruptedChildStopped }), /scope|git state/);
  const paths = recoveryPaths(f.run.runDir, f.run.dispatches[0]);
  assert.equal(JSON.parse(fs.readFileSync(paths.transactionPath)).status, 'FAIL');
  await assert.rejects(runDispatch({ ...f.opts, recoverInterrupted: f.request }, native));
  assert.equal(native.calls(), 1); assert.equal(JSON.parse(fs.readFileSync(f.originalFile)).status, 'RUNNING');
});

test('completed recovery rejects missing, tampered, duplicate or unbound lineage on finalization', async t => {
  const f = await interruptedReview(t);
  const prepared = await runDispatch({ ...f.opts, prepareRecovery: f.request }, f.deps);
  f.opts.recoverySha256 = prepared.recoverySha256;
  await runDispatch({ ...f.opts, recoverInterrupted: f.request }, { ...f.deps, ...fakeVendor(), assertInterruptedChildStopped: f.deps.assertInterruptedChildStopped });
  const paths = require('./dispatch-evidence.js').recoveryPaths(f.run.runDir, f.run.dispatches[0]);
  const originalManifest = fs.readFileSync(paths.manifestPath);
  fs.unlinkSync(paths.manifestPath);
  assert.equal(inspectRun(f.run.runDir).outcomes[0].status, 'INVALID');
  fs.writeFileSync(paths.manifestPath, originalManifest);
  fs.appendFileSync(paths.manifestPath, '\n');
  assert.equal(inspectRun(f.run.runDir).outcomes[0].status, 'INVALID');
  fs.writeFileSync(paths.manifestPath, originalManifest);
  const extra = path.join(paths.root, 'second-attempt'); fs.mkdirSync(extra);
  assert.equal(inspectRun(f.run.runDir).outcomes[0].status, 'INVALID'); fs.rmdirSync(extra);
  const state = JSON.parse(fs.readFileSync(paths.transactionPath)); delete state.recoverySha256; writeJson(paths.transactionPath, state);
  assert.equal(inspectRun(f.run.runDir).outcomes[0].status, 'INVALID');
  assert.throws(() => require('./dispatch-evidence.js').verifyCommittedRow(state.telemetry), /missing recovery lineage/);
});
