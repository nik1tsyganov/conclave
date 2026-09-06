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
