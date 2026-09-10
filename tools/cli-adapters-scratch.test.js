'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { temporary } = require('./test-fixtures.js');
const { openaiLaunch, validateOpenaiScratchLaunch } = require('./cli-adapters.js');
const { parseCodex } = require('./cli-proof.js');

function fixture(t) {
  const root = temporary(t);
  const runDir = path.join(root, 'run');
  const evidence = path.join(runDir, 'out', 'verify-one');
  const cwd = path.join(root, 'product');
  fs.mkdirSync(evidence, { recursive: true });
  fs.mkdirSync(cwd);
  const briefPath = path.join(evidence, 'BRIEF.md');
  const seatContractPath = path.join(evidence, 'SEAT-CONTRACT.md');
  const skillRoot = path.join(evidence, 'skills');
  fs.mkdirSync(skillRoot);
  fs.writeFileSync(briefPath, 'ACK scratch\nVerify source.\n');
  fs.writeFileSync(seatContractPath, 'Read source.\n');
  const opts = { runDir, dispatchId: 'verify-one', cwd, briefPath, seatContractPath, skillRoot,
    capturePath: path.join(evidence, 'capture.txt'), role: 'verify', model: 'gpt-5.6-terra', effort: 'medium',
    readonlyScratch: true, mustExistBinary: false,
    env: { MAGI_DEV_ROOT: root, MAGI_CODEX_BIN: 'C:\\bin\\codex.exe', temp: 'unsafe', TMP: 'unsafe', NPM_CONFIG_CACHE: 'unsafe' } };
  return { root, evidence, opts };
}

function proofOptions(f, launch) {
  return { expectedSandbox: 'custom permissions', expectedEffort: 'medium', expectedRole: 'verify',
    expectedCwd: launch.cwd, runDir: f.opts.runDir, dispatchId: f.opts.dispatchId, capture: f.opts.capturePath, launch };
}

const banner = 'OpenAI Codex v0.153.4\n--------\nsession id: session-one\nmodel: gpt-5.6-terra\nsandbox: custom permissions\nreasoning effort: medium\n--------\ntokens used\n123\n';

test('scratch opt-in binds one write directory and replaces the whole profile', t => {
  const f = fixture(t);
  const launch = openaiLaunch(f.opts);
  const scratch = path.join(f.evidence, 'scratch');
  assert.equal(launch.scratchPermissions.scratchPath, scratch);
  assert.equal(launch.requestedSandbox, 'custom permissions');
  assert.ok(fs.statSync(scratch).isDirectory());
  assert.equal(launch.env.TEMP, scratch);
  assert.equal(launch.env.TMP, scratch);
  assert.equal(launch.env.npm_config_cache, path.join(scratch, 'npm-cache'));
  assert.equal(launch.env.temp, undefined);
  assert.equal(launch.env.NPM_CONFIG_CACHE, undefined);
  assert.ok(launch.args.includes('default_permissions="magi_readonly_scratch"'));
  const profile = launch.args.find(arg => arg.startsWith('permissions.'));
  assert.ok(profile.startsWith('permissions.magi_readonly_scratch={'), 'whole table replaces inherited named-profile grants');
  assert.match(profile, /extends = ":read-only"/);
  assert.match(profile, /network = \{ enabled = false \}/);
  assert.equal((profile.match(/"write"/g) || []).length, 1);
  assert.ok(!launch.args.includes('-s'));
  assert.ok(!launch.args.includes('-P'));
  assert.ok(!launch.args.some(arg => arg.includes('dangerously')));
  assert.deepEqual(validateOpenaiScratchLaunch(launch, { ...f.opts, cwd: launch.cwd }), launch.scratchPermissions);
  assert.deepEqual(parseCodex(banner, f.opts.model, proofOptions(f, launch)).scratchPermissions, launch.scratchPermissions);
});

test('scratch rejects unbound inputs, implementation, product and protected-path collisions', t => {
  const f = fixture(t);
  for (const changes of [
    { runDir: undefined }, { dispatchId: '../escape' }, { dispatchId: 'x/y' }, { readonlyScratch: '/arbitrary/path' },
    { role: 'implement' }, { capturePath: path.join(f.root, 'capture.txt') },
    { cwd: f.root }, { skillRoot: path.join(f.evidence, 'scratch') },
    { seatContractPath: path.join(f.evidence, 'scratch', 'contract.md') },
  ]) assert.throws(() => openaiLaunch({ ...f.opts, ...changes }), /scratch|readonlyScratch/);
  assert.equal(fs.existsSync(path.join(f.evidence, 'scratch')), false);
});

test('scratch refuses junctions in its derived path', t => {
  const f = fixture(t);
  const target = path.join(f.root, 'unrelated');
  fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(f.evidence, 'scratch'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => openaiLaunch(f.opts), /symlink|junction/);
  assert.deepEqual(fs.readdirSync(target), []);
});

test('scratch accepts the sealed plan identifier alphabet including dots', t => {
  const f = fixture(t);
  const dispatchId = 'verify.unit-1.v2';
  const opts = { ...f.opts, dispatchId, capturePath: path.join(f.opts.runDir, 'out', dispatchId, 'capture.txt') };
  const launch = openaiLaunch(opts);
  assert.equal(launch.scratchPermissions.scratchPath, path.join(f.opts.runDir, 'out', dispatchId, 'scratch'));
  assert.deepEqual(validateOpenaiScratchLaunch(launch, { ...opts, cwd: launch.cwd }), launch.scratchPermissions);
});

test('custom banner alone and altered scratch launch evidence never suffice', t => {
  const f = fixture(t);
  const launch = openaiLaunch(f.opts);
  const options = proofOptions(f, launch);
  assert.throws(() => parseCodex(banner, f.opts.model), /bound scratch launch/);
  assert.throws(() => parseCodex(banner, f.opts.model, { ...options, launch: undefined }), /scratch launch validation/);
  for (const mutate of [
    copy => copy.args.push('-c', 'permissions.magi_readonly_scratch.filesystem={ ":root" = "write" }'),
    copy => copy.args.push('-c', 'default_permissions=":danger-full-access"'),
    copy => copy.args.push('--dangerously-bypass-approvals-and-sandbox'),
    copy => { copy.args[copy.args.findIndex(arg => arg.startsWith('permissions.'))] = 'permissions.magi_readonly_scratch={ extends = ":workspace" }'; },
    copy => { copy.scratchPermissions.scratchPath = f.root; },
    copy => { copy.scratchEnv.TEMP = f.root; },
    copy => { copy.env.tmp = f.root; },
    copy => { copy.role = 'implement'; },
  ]) {
    const copy = structuredClone(launch);
    mutate(copy);
    assert.throws(() => parseCodex(banner, f.opts.model, { ...options, launch: copy }), /scratch launch validation/);
  }
  assert.throws(() => parseCodex(banner, f.opts.model, { ...options, dispatchId: 'other-dispatch' }), /scratch launch validation/);
  assert.throws(() => parseCodex(banner.replace('custom permissions', 'read-only'), f.opts.model, options), /sandbox mismatch/);
});
