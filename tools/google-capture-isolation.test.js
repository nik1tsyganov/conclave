'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { googleCaptureEnv } = require('./cli-adapters.js');
const { runDispatch } = require('./dispatch-run.js');
const { probe } = require('./model-probe.js');
const { hashFile } = require('./dispatch-evidence.js');
const { createSealedRun, fakeVendor, nativeCapture, temporary } = require('./test-fixtures.js');

test('Google capture helper preserves POSIX paths and explicit Windows paths on a POSIX host', () => {
  const filename = path.join(__dirname, 'cli-adapters.js');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, process: { platform: 'linux' },
    require: name => name === 'node:path' ? path.posix : require(name),
  }, { filename });
  for (const [root, expected] of [
    ['/tmp/magi-probe', '/tmp/magi-probe/synara-capture-events.jsonl'],
    ['C:\\tmp\\magi-probe', 'C:\\tmp\\magi-probe\\synara-capture-events.jsonl'],
    ['\\\\server\\share\\magi-probe', '\\\\server\\share\\magi-probe\\synara-capture-events.jsonl'],
  ]) {
    const capture = module.exports.googleCaptureEnv({}, root);
    assert.equal(capture.eventsPath, expected);
    assert.equal(capture.env.SYNARA_ANTIGRAVITY_EVENTS, expected);
    assert.equal(capture.trust, 'diagnostic-untrusted');
  }
});

function googleRun(t) {
  const run = createSealedRun(t, [{ class: 'debug-mystery', vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high' }]);
  const native = fakeVendor();
  const build = native.buildLaunch;
  native.buildLaunch = opts => {
    const capture = googleCaptureEnv({}, path.dirname(opts.capturePath));
    return { ...build(opts), env: capture.env, synaraCaptureEventsPath: capture.eventsPath, synaraCaptureEventsTrust: capture.trust };
  };
  return { ...run, native };
}

test('Google dispatch stores a fresh hashed diagnostic stream and rejects replay tampering', async t => {
  const run = googleRun(t);
  const build = run.native.buildLaunch;
  const execute = run.native.runLaunch;
  run.native.buildLaunch = opts => {
    const launch = build(opts);
    fs.writeFileSync(launch.synaraCaptureEventsPath, 'stale\n');
    return launch;
  };
  run.native.runLaunch = async launch => {
    assert.equal(fs.existsSync(launch.synaraCaptureEventsPath), false);
    fs.writeFileSync(launch.synaraCaptureEventsPath, 'untrusted diagnostic\n');
    return execute(launch);
  };
  const opts = { ...run.opts, dispatchId: 'd1' };
  const result = await runDispatch(opts, run.native);
  const launch = JSON.parse(fs.readFileSync(path.join(run.runDir, 'out/d1/launch.json'), 'utf8'));
  assert.equal(launch.synaraCaptureEventsTrust, 'diagnostic-untrusted');
  const state = JSON.parse(fs.readFileSync(result.receipt.transactionPath, 'utf8'));
  assert.deepEqual(state.artifacts.find(item => item.path === launch.synaraCaptureEventsPath), {
    path: launch.synaraCaptureEventsPath, sha256: hashFile(launch.synaraCaptureEventsPath), trust: 'diagnostic-untrusted',
  });
  fs.appendFileSync(launch.synaraCaptureEventsPath, 'tamper');
  await assert.rejects(runDispatch(opts, run.native), /committed evidence changed/);
  assert.equal(run.native.calls(), 1);
});

test('Google rejects redirected, conflicting and linked capture targets before child execution', async t => {
  for (const kind of ['external', 'capture', 'env', 'hardlink']) {
    const run = googleRun(t);
    const build = run.native.buildLaunch;
    const target = path.join(run.root, 'outside.txt'); fs.writeFileSync(target, 'keep');
    run.native.buildLaunch = opts => {
      const launch = build(opts);
      if (kind === 'external') launch.synaraCaptureEventsPath = target;
      if (kind === 'capture') launch.synaraCaptureEventsPath = opts.capturePath;
      if (kind === 'env') launch.env.SYNARA_ANTIGRAVITY_EVENTS = target;
      if (kind === 'hardlink') fs.linkSync(target, launch.synaraCaptureEventsPath);
      return launch;
    };
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, run.native), /capture|hard links/);
    assert.equal(run.native.calls(), 0);
    assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
  }
});

test('Google diagnostic output cannot replace native model proof or escape through a new hard link', async t => {
  for (const kind of ['identity', 'hardlink']) {
    const run = googleRun(t);
    const execute = run.native.runLaunch;
    const target = path.join(run.root, 'outside.txt'); fs.writeFileSync(target, 'keep');
    run.native.runLaunch = async launch => {
      const result = await execute(launch);
      if (kind === 'hardlink') fs.linkSync(target, launch.synaraCaptureEventsPath);
      else {
        fs.writeFileSync(launch.synaraCaptureEventsPath, result.stderr);
        result.stderr = result.stderr.replaceAll('gemini-3.1-pro-high', 'wrong-model');
      }
      return result;
    };
    await assert.rejects(runDispatch({ ...run.opts, dispatchId: 'd1' }, run.native), /model|hard links/);
    assert.equal(run.native.calls(), 1);
    assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
  }
});

test('Google probe isolates parent capture state and records diagnostic hashes without trusting identity', async t => {
  const root = temporary(t, 'magi-google-probe-');
  const original = process.env.MAGI_AGY_BIN;
  process.env.MAGI_AGY_BIN = process.execPath;
  t.after(() => { if (original === undefined) delete process.env.MAGI_AGY_BIN; else process.env.MAGI_AGY_BIN = original; });
  const parent = Object.freeze({ MAGI_ALLOWED_WORKSPACE_ROOTS: root, MAGI_AGY_BIN: process.execPath,
    SYNARA_ANTIGRAVITY_EVENTS: path.join(root, 'parent.jsonl'), SYNARA_ANTIGRAVITY_HOOK_DECISION: 'ask' });
  for (const wrongModel of [false, true]) {
    const evidenceDir = path.join(root, wrongModel ? 'wrong' : 'valid');
    const pending = probe({ vendor: 'google', model: 'gemini-3.1-pro-high', effort: 'fused-high', evidenceDir }, {
      env: parent,
      runLaunch: async launch => {
        assert.equal(launch.env.SYNARA_ANTIGRAVITY_EVENTS, path.join(evidenceDir, 'synara-capture-events.jsonl'));
        assert.equal(launch.env.SYNARA_ANTIGRAVITY_HOOK_DECISION, 'allow');
        const challenge = launch.args.at(-1).match(/MAGI_PROBE_[a-f0-9]{32}/)[0];
        const native = nativeCapture('google', 'gemini-3.1-pro-high', 'fused-high', challenge);
        fs.writeFileSync(launch.synaraCaptureEventsPath, native.log);
        const log = wrongModel ? native.log.replaceAll('gemini-3.1-pro-high', 'wrong-model') : native.log;
        fs.writeFileSync(launch.args[launch.args.indexOf('--log-file') + 1], log);
        return { ok: true, exitCode: 0, exitConfirmed: true, stdout: native.capture, stderr: log };
      },
    });
    if (wrongModel) await assert.rejects(pending, /model/);
    else {
      const result = await pending;
      const eventsPath = path.join(evidenceDir, 'synara-capture-events.jsonl');
      assert.deepEqual(result.synaraCaptureEvents, { path: eventsPath, sha256: hashFile(eventsPath), trust: 'diagnostic-untrusted' });
      const launch = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'launch.json'), 'utf8'));
      assert.equal(launch.synaraCaptureEventsPath, eventsPath);
      assert.equal(launch.synaraCaptureEventsTrust, 'diagnostic-untrusted');
    }
  }
  assert.equal(parent.SYNARA_ANTIGRAVITY_HOOK_DECISION, 'ask');
  assert.equal(fs.existsSync(parent.SYNARA_ANTIGRAVITY_EVENTS), false);
});
