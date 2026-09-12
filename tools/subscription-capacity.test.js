'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { temporary, createSealedRun, fakeVendor, capacityFixture: receipts } = require('./test-fixtures');
const { hashFile, snapshotWorkspace } = require('./dispatch-evidence');

for (const tool of ['model-probe', 'dispatch-run']) for (const condition of ['missing', 'expired', 'tampered', 'invalid-native-state']) {
  test(`real ${tool} entrypoint rejects ${condition} admission without launch or evidence writes`,
    { skip: condition === 'invalid-native-state' && process.platform !== 'win32' }, t => {
    const f = createSealedRun(t); const files = receipts(f.root);
    const marker = path.join(f.root, 'native-launch-attempt.txt'), preload = path.join(f.root, 'observe-spawn.cjs');
    fs.writeFileSync(preload, `const fs=require('node:fs'), child=require('node:child_process');
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) child[name]=()=>{fs.writeFileSync(${JSON.stringify(marker)},name);throw new Error('TEST_ONLY_NATIVE_LAUNCH_ATTEMPT');};`);
    const env = { ...process.env, MAGI_ALLOWED_WORKSPACE_ROOTS: f.root, MAGI_CODEX_BIN: process.execPath };
    delete env.MAGI_CAPACITY_RECEIPT; delete env.MAGI_LEGACY_CAPACITY;
    if (condition === 'expired') {
      const value = JSON.parse(fs.readFileSync(files.capacity));
      value.observations.forEach(row => { row.observedAt = new Date(Date.now() - 1800000).toISOString(); row.expiresAt = new Date(Date.now() - 1000).toISOString(); });
      fs.writeFileSync(files.capacity, JSON.stringify(value));
    }
    if (condition === 'tampered') fs.appendFileSync(files.source, 'changed');
    if (condition === 'invalid-native-state') {
      env.CODEX_HOME = path.join(f.root, 'native-home');
      fs.mkdirSync(path.join(env.CODEX_HOME, '.sandbox'), { recursive: true });
      fs.writeFileSync(path.join(env.CODEX_HOME, '.sandbox', 'deny_read_acl_state.json'), '{malformed');
    }
    const args = tool === 'model-probe'
      ? ['--vendor', 'openai', '--model', 'gpt-6-astra', '--effort', 'high', '--cwd', f.cwd, '--evidence-dir', path.join(f.root, 'probe')]
      : ['--plan', f.opts.plan, '--run-dir', f.runDir, '--dispatch-id', 'd1', '--rules-root', f.opts.rulesRoot, '--max-wall-ms', '1000'];
    if (condition !== 'missing') args.push('--capacity', files.capacity, '--legacy-capacity', files.legacyCapacity);
    const before = snapshotWorkspace(f.root);
    const result = spawnSync(process.execPath, ['--require', preload, path.join(__dirname, tool + '.js'), ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, condition === 'invalid-native-state' ? /native sandbox state/i : /CAPACITY_FAIL/);
    assert.equal(fs.existsSync(marker), false, 'the real entrypoint must not attempt any native subprocess');
    assert.deepEqual(snapshotWorkspace(f.root), before, 'admission refusal must be read-only');
  });
}

test('shared admission binds files, uses environment paths and covers the planned timeout', t => {
  const root = temporary(t, 'magi-capacity-'), files = receipts(root);
  const { admitCapacity } = require('./subscription-capacity');
  const pair = { vendor: 'openai', model: 'gpt-6-astra', effort: 'high' };
  const admission = admitCapacity({}, pair, 1000, { MAGI_CAPACITY_RECEIPT: files.capacity, MAGI_LEGACY_CAPACITY: files.legacyCapacity });
  admission.revalidate();
  assert.equal(admission.record.observationId, 'openai-fixture');
  assert.throws(() => admitCapacity(files, pair, 1800000), /CAPACITY|expired|30 minutes/);
  fs.appendFileSync(files.capacity, ' ');
  assert.throws(() => admission.revalidate(), /changed/);
});

test('shared admission rechecks source bytes and expiry immediately before launch', t => {
  const root = temporary(t, 'magi-capacity-'), files = receipts(root);
  const { admitCapacity } = require('./subscription-capacity');
  const pair = { vendor: 'openai', model: 'gpt-6-astra', effort: 'high' };
  const admission = admitCapacity(files, pair, 1000);
  const now = Date.now(); t.mock.method(Date, 'now', () => now + 1800000);
  assert.throws(() => admission.revalidate(), /expired/);
  t.mock.restoreAll(); fs.appendFileSync(files.source, 'changed');
  assert.throws(() => admission.revalidate(), /changed/);
});

test('capacity JSON accepts UTF-8 BOM while preserving its raw-byte binding', t => {
  const root = temporary(t, 'magi-capacity-'), files = receipts(root);
  for (const file of [files.capacity, files.legacyCapacity]) fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fs.readFileSync(file)]));
  const admission = require('./subscription-capacity').admitCapacity(files, { vendor: 'openai', model: 'gpt-6-astra', effort: 'high' }, 1000);
  admission.revalidate();
  assert.equal(admission.record.receiptSha256, hashFile(files.capacity));
  assert.equal(admission.record.legacySha256, hashFile(files.legacyCapacity));
});

test('capacity JSON rejects malformed UTF-8 without replacement decoding', t => {
  const root = temporary(t, 'magi-capacity-'), files = receipts(root);
  for (const file of [files.capacity, files.legacyCapacity]) {
    const original = fs.readFileSync(file);
    fs.writeFileSync(file, Buffer.concat([original.subarray(0, original.length - 1), Buffer.from(',"invalid":"'), Buffer.from([0xff]), Buffer.from('"}')]));
    assert.throws(() => require('./subscription-capacity').admitCapacity(files, { vendor: 'openai', model: 'gpt-6-astra', effort: 'high' }, 1000), /must use UTF-8/);
    fs.writeFileSync(file, original);
  }
});

test('dispatch rechecks receipt bytes after staging and before native launch', async t => {
  const f = createSealedRun(t), vendor = fakeVendor();
  const buildLaunch = vendor.buildLaunch;
  vendor.buildLaunch = opts => { const launch = buildLaunch(opts); fs.appendFileSync(f.opts.capacity, ' '); return launch; };
  await assert.rejects(require('./dispatch-run').runDispatch({ ...f.opts, dispatchId: 'd1' }, vendor), /Capacity files changed/);
  assert.equal(vendor.calls(), 0);
  assert.equal(fs.existsSync(path.join(f.cwd, 'result.txt')), false);
});

test('completed dispatch replay and Claude attestation do not need current quota or native state', async t => {
  for (const vendorName of ['openai', 'anthropic']) {
    const f = createSealedRun(t, [{ vendor: vendorName, ...(vendorName === 'anthropic' ? { model: 'sonnet', effort: 'medium' } : {}) }]);
    const vendor = fakeVendor();
    const opts = { ...f.opts, dispatchId: 'd1' };
    const result = await require('./dispatch-run').runDispatch(opts, vendor);
    const contract = fs.readFileSync(path.join(f.runDir, 'out', 'd1', 'SEAT-CONTRACT.md'), 'utf8');
    const profile = JSON.parse(fs.readFileSync(path.join(f.runDir, 'out', 'd1', 'seat-profile.json')));
    assert.ok(profile.lessons.length > 0);
    for (const lesson of profile.lessons) assert.ok(contract.includes(`- ${lesson.id}: ${lesson.procedure}`));
    fs.unlinkSync(f.opts.capacity); fs.unlinkSync(f.opts.legacyCapacity);
    vendor.checkNativeLaunchState = () => { throw new Error('replay cannot check native state'); };
    const replay = await require('./dispatch-run').runDispatch(vendorName === 'anthropic'
      ? { ...opts, onTopic: true, captureSha256: result.captureSha256 || result.receipt?.captureSha256 }
      : opts, vendor);
    assert.equal(replay.ok, true);
    assert.equal(vendor.calls(), 1);
  }
});
