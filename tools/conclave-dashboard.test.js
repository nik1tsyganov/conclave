// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
// WRITE tests: all run/fixture mutations use disposable temporary directories.
// Native vendor calls are forbidden; the one runner integration uses fakeVendor.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');
const test = require('node:test');
const { LIMITS, createSnapshot, startServer, parseArgs } = require('./conclave-dashboard.js');
const { createSealedRun, fakeVendor, temporary } = require('./test-fixtures.js');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
function fixture(t, entries = [{}]) {
  const root = temporary(t, 'conclave-dashboard-');
  const runDir = path.join(root, 'run'); fs.mkdirSync(runDir);
  const dispatches = entries.map((entry, index) => ({ dispatchId: `d${index + 1}`, unitId: 'unit', role: 'implement', vendor: 'openai', model: 'gpt-6-astra', effort: 'high', class: 'standard-feature', ...entry }));
  const plan = { planId: 'dashboard-fixture', hostMode: 'cursor-cli', dispatches };
  write(path.join(runDir, 'dispatch-plan.json'), plan);
  const seal = { schemaVersion: 2, planId: plan.planId, planHash: hash(fs.readFileSync(path.join(runDir, 'dispatch-plan.json'))), sealedAt: '2026-09-12T12:00:00.000Z' };
  write(path.join(runDir, 'plan-seal.json'), seal);
  function state(index = 0, status = 'RUNNING') {
    const entry = dispatches[index];
    const key = hash(JSON.stringify([entry.dispatchId, entry.unitId, entry.role]));
    const evidenceDir = path.join(runDir, 'out', entry.dispatchId);
    const value = { schemaVersion: 1, status, planId: plan.planId, planHash: seal.planHash, entry, requestHash: hash(JSON.stringify({ planHash: seal.planHash, entry })), evidenceDir, startedAt: '2026-09-12T12:01:00.000Z' };
    const file = path.join(runDir, '.conclave-dispatches', `${key}.json`);
    write(file, value);
    return { file, value, key, evidenceDir };
  }
  return { root, runDir, plan, seal, dispatches, state };
}
function inventory(root, relative = '', result = {}) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) inventory(root, name, result);
    else result[name] = hash(fs.readFileSync(path.join(root, name)));
  }
  return result;
}
function request(dashboard, { route = '/api/snapshot', method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${dashboard.origin}${route}`, { method, headers: { Authorization: `Bearer ${dashboard.token}`, ...headers } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.end();
  });
}
async function serve(t, runDir) {
  const dashboard = await startServer({ runDir });
  t.after(async () => { dashboard.server.closeAllConnections(); await new Promise(resolve => dashboard.server.close(resolve)); });
  return dashboard;
}
function fakeWithClose() {
  const native = fakeVendor();
  return { ...native, runLaunch: async launch => {
    const startedAt = new Date().toISOString();
    const result = await native.runLaunch(launch);
    return { ...result, lifetime: { protocol: 'conclave-process-lifetime-v1', startedAt, endedAt: new Date().toISOString(), exitConfirmed: true, exitEvidence: 'child-close-event' } };
  } };
}

test('real sealed fixture moves through native fake execution without observer writes or approval promotion', async t => {
  const run = createSealedRun(t);
  const beforeStart = inventory(run.runDir);
  const planned = createSnapshot(run.runDir);
  assert.equal(planned.dispatches[0].status, 'NOT_STARTED');
  assert.deepEqual(inventory(run.runDir), beforeStart);
  const result = await require('./dispatch-run.js').runDispatch({ ...run.opts, dispatchId: 'd1' }, fakeWithClose());
  assert.equal(result.ok, true);
  const beforeObserve = inventory(run.runDir);
  const completed = createSnapshot(run.runDir);
  assert.equal(completed.dispatches[0].status, 'PASS', JSON.stringify(completed.dispatches[0]));
  assert.equal(completed.dispatches[0].proofId, result.proofId);
  assert.equal(completed.run.approvalStatus, 'UNKNOWN');
  assert.equal(completed.dispatches[0].vote, null);
  assert.ok(completed.events.some(event => event.kind === 'child_close'));
  assert.deepEqual(inventory(run.runDir), beforeObserve);
  const entry = run.dispatches[0];
  write(path.join(run.runDir, 'run-summary.json'), { schemaVersion: 1, planId: run.sealed.planId, planHash: run.sealed.planHash, finalizedAt: new Date().toISOString(), executionStatus: 'PASS', approvalStatus: 'PASS', ok: true, units: [{ unitId: entry.unitId, status: 'PASS', reason: null }], outcomes: [{ ...entry, planId: run.sealed.planId, planHash: run.sealed.planHash, status: 'PASS' }] });
  const recorded = createSnapshot(run.runDir);
  assert.equal(recorded.run.approvalStatus, 'RECORDED_PASS');
  assert.equal(recorded.dispatches[0].vote, null);
  fs.rmSync(path.join(run.runDir, 'out', entry.dispatchId, 'proof.json'));
  const partial = createSnapshot(run.runDir);
  assert.equal(partial.dispatches[0].status, 'UNKNOWN');
  assert.equal(partial.run.approvalStatus, 'UNKNOWN');
});

test('genuine Claude checkpoint remains awaiting attestation with no approval or vote', async t => {
  const route = require('./dispatch-matrix.js').loadMatrix().classes['test-verification'].verify.find(row => row.vendor === 'anthropic');
  const run = createSealedRun(t, [{ ...route, role: 'verify', class: 'test-verification', authorVendor: 'openai' }]);
  const result = await require('./dispatch-run.js').runDispatch({ ...run.opts, dispatchId: 'd1' }, fakeWithClose());
  assert.equal(result.status, 'AWAITING_ATTESTATION');
  const frozen = inventory(run.runDir);
  const snapshot = createSnapshot(run.runDir);
  assert.equal(snapshot.dispatches[0].status, 'AWAITING_ATTESTATION');
  assert.equal(snapshot.dispatches[0].vote, null);
  assert.equal(snapshot.run.approvalStatus, 'UNKNOWN');
  assert.ok(snapshot.events.some(event => event.kind === 'checkpoint' && event.status === 'AWAITING_ATTESTATION'));
  assert.deepEqual(inventory(run.runDir), frozen);
});

test('observed handoffs retain launch references and distinguish consumer recovery attempts', t => {
  const run = fixture(t, [{}, { role: 'verify', vendor: 'google' }]);
  const original = run.state(1);
  write(path.join(original.evidenceDir, 'launch.json'), { planEntry: original.value.entry, planId: run.plan.planId, planHash: run.seal.planHash, startedAt: original.value.startedAt, prerequisites: [{ dispatchId: 'd1', proofId: 'a'.repeat(64), transactionSha256: 'b'.repeat(64) }] });
  const snapshot = createSnapshot(run.runDir, { nowMs: Date.parse('2026-09-12T12:02:00Z') });
  assert.equal(snapshot.run.executionStatus, 'RUNNING');
  assert.ok(snapshot.edges.some(edge => edge.from === 'd1' && edge.to === 'd2' && edge.kind === 'planned_dependency' && edge.observed === false));
  const handoff = snapshot.edges.find(edge => edge.kind === 'prerequisite');
  assert.deepEqual(handoff, { id: 'prerequisite:d1:d2:0', from: 'd1', to: 'd2', kind: 'prerequisite', label: 'Bound prerequisite recorded at launch', observed: true, at: original.value.startedAt, source: 'out/d2/launch.json', proofId: 'a'.repeat(64), transactionSha256: 'b'.repeat(64), attemptId: 'd2:0', attemptNumber: 0 });
  assert.ok(snapshot.edges.some(edge => edge.from === 'arbiter' && edge.to === 'd2' && edge.kind === 'dispatch'));
  assert.ok(snapshot.edges.every(edge => typeof edge.id === 'string'));
  for (const number of [1, 2]) {
    const relative = `.conclave-recoveries/${original.key}${number === 2 ? '.2' : ''}`;
    const evidenceDir = path.join(run.runDir, relative, 'attempt/out/d2');
    const startedAt = `2026-09-12T12:0${number + 1}:00.000Z`;
    write(path.join(run.runDir, relative, 'transaction.json'), { ...original.value, evidenceDir, startedAt });
    write(path.join(evidenceDir, 'launch.json'), { planEntry: original.value.entry, planId: run.plan.planId, planHash: run.seal.planHash, startedAt, prerequisites: [{ dispatchId: 'd1', proofId: 'a'.repeat(64), transactionSha256: 'b'.repeat(64) }] });
  }
  const recovered = createSnapshot(run.runDir, { nowMs: Date.parse('2026-09-12T12:04:00Z') });
  const handoffs = recovered.edges.filter(edge => edge.kind === 'prerequisite');
  assert.deepEqual(handoffs.map(edge => edge.id), ['prerequisite:d1:d2:0', 'prerequisite:d1:d2:1', 'prerequisite:d1:d2:2']);
  assert.deepEqual(handoffs.map(edge => edge.attemptId), ['d2:0', 'd2:1', 'd2:2']);
  assert.equal(handoffs[2].source, `.conclave-recoveries/${original.key}.2/attempt/out/d2/launch.json`);
  assert.equal(recovered.dispatches[1].issue, 'RECOVERY_LINEAGE_UNVERIFIED');
  assert.equal(recovered.run.approvalStatus, 'UNKNOWN');
  assert.deepEqual(createSnapshot(run.runDir, { nowMs: Date.parse('2026-09-12T12:04:00Z') }).edges, recovered.edges);
});

test('real producer handoffs expose only recorded prerequisite references without observer writes', async t => {
  const route = require('./dispatch-matrix.js').loadMatrix().classes['test-verification'].verify.find(row => row.vendor === 'google');
  const run = createSealedRun(t, [{ unitId: 'product' }, { ...route, unitId: 'product', role: 'verify', class: 'test-verification', authorVendor: 'openai' }]);
  const { runDispatch } = require('./dispatch-run.js');
  const implementation = await runDispatch({ ...run.opts, dispatchId: 'd1' }, fakeWithClose());
  assert.equal(implementation.ok, true);
  const verification = await runDispatch({ ...run.opts, dispatchId: 'd2' }, fakeWithClose());
  assert.equal(verification.ok, true);
  const frozen = inventory(run.runDir);
  const snapshot = createSnapshot(run.runDir);
  const launch = JSON.parse(fs.readFileSync(path.join(run.runDir, 'out/d2/launch.json'), 'utf8'));
  const edge = snapshot.edges.find(row => row.kind === 'prerequisite' && row.to === 'd2');
  assert.equal(edge.at, launch.startedAt);
  assert.equal(edge.proofId, implementation.proofId);
  assert.equal(edge.transactionSha256, launch.prerequisites[0].transactionSha256);
  assert.equal(edge.source, 'out/d2/launch.json');
  assert.equal(edge.attemptId, 'd2:0');
  assert.equal(snapshot.run.approvalStatus, 'UNKNOWN');
  assert.deepEqual(inventory(run.runDir), frozen);
});

test('invalid and future launch timestamps cannot appear as observed handoffs', t => {
  const run = fixture(t, [{}, { role: 'verify', vendor: 'google' }]);
  const original = run.state(1);
  for (const startedAt of [null, 'not-a-date', '2026-09-12T12:03:00.000Z']) {
    write(original.file, { ...original.value, startedAt });
    write(path.join(original.evidenceDir, 'launch.json'), { planEntry: original.value.entry, planId: run.plan.planId, planHash: run.seal.planHash, startedAt, prerequisites: [{ dispatchId: 'd1', proofId: 'a'.repeat(64), transactionSha256: 'b'.repeat(64) }] });
    const snapshot = createSnapshot(run.runDir, { nowMs: Date.parse('2026-09-12T12:02:00Z') });
    assert.equal(snapshot.dispatches[1].status, 'UNKNOWN');
    assert.ok(!snapshot.edges.some(edge => edge.observed && edge.to === 'd2'), JSON.stringify(startedAt));
    assert.ok(!snapshot.events.some(event => event.kind === 'launch'), JSON.stringify(startedAt));
    assert.ok(snapshot.edges.some(edge => edge.kind === 'planned_dependency'));
  }
});

test('handoff animation admits only unseen recent records during continuous observation', () => {
  const { newHandoffIds } = require('./dashboard.js');
  const nowMs = Date.parse('2026-09-12T12:02:00.000Z');
  const row = (id, age = 1000, extra = {}) => ({ id, observed: true, kind: 'prerequisite', at: new Date(nowMs - age).toISOString(), ...extra });
  const edges = [row('recent'), row('old', 15001), row('future', -1), row('seen'), row('planned', 1000, { observed: false }), row('dispatch', 1000, { kind: 'dispatch' }), row('invalid', 1000, { at: 'not-a-date' }), row('missing', 1000, { at: null }), row('no-id', 1000, { id: undefined }), row('oldest-admitted', 15000), row('current', 0)];
  const seen = new Set(['seen']);
  for (const state of ['initial observation', 'reconnect', 'pause or resume']) {
    assert.deepEqual(newHandoffIds(edges, seen, { continuous: false, nowMs }), [], state);
  }
  assert.deepEqual(newHandoffIds(edges, seen, { continuous: true, nowMs }), ['recent', 'oldest-admitted', 'current']);
  assert.deepEqual([...seen], ['seen'], 'Admission must not alter caller observation history');
});

test('real refresh does not pulse arrivals across interrupted observation', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8');
  for (const mode of ['pause-pending', 'hide-pending', 'paused-refresh', 'hidden-response']) {
    const nodes = new Map(), requests = [], timers = new Map(), handlers = {}; let timerId = 0;
    function element(key) {
      if (nodes.has(key)) return nodes.get(key);
      let classes = new Set();
      const node = { dataset: {}, handlers: {}, value: '', textContent: '', open: false,
        get className() { return [...classes].join(' '); }, set className(value) { classes = new Set(value.split(/\s+/).filter(Boolean)); },
        classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value),
          toggle(value, enabled = !classes.has(value)) { if (enabled) classes.add(value); else classes.delete(value); } },
        addEventListener(name, callback) { this.handlers[name] = callback; }, setAttribute() {}, append() {}, replaceChildren() {}, focus() {},
        querySelector: selector => element(key + selector), get lastElementChild() { return element(key + ':last'); },
      };
      nodes.set(key, node); return node;
    }
    const seats = ['all', 'openai', 'anthropic', 'google'].map(vendor => { const node = element('seat:' + vendor); node.dataset.vendor = vendor; return node; });
    const document = { hidden: false, activeElement: null, body: element('body'),
      getElementById: element, createElement: () => element('created:' + nodes.size),
      querySelector: selector => { const vendor = selector.match(/data-vendor="([a-z]+)"/); return element(vendor ? 'seat:' + vendor[1] : selector); },
      querySelectorAll: selector => selector === '[data-vendor]' ? seats : [...nodes.values()].filter(node => node.classList.contains('handoff-pulse')),
      addEventListener(name, callback) { handlers[name] = callback; },
    };
    require('node:vm').runInNewContext(source, { document, location: { hash: '#token=fixture' }, URLSearchParams, AbortController,
      fetch: () => new Promise(resolve => requests.push(resolve)),
      setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
    });
    const edge = number => ({ id: 'prerequisite:d1:d2:' + number, kind: 'prerequisite', from: 'd1', to: 'd2', observed: true, at: new Date(Date.now() - 1000).toISOString() });
    const first = edge(0), second = edge(1);
    async function answer(edges) {
      assert.equal(requests.length, 1, mode + ': one request must be pending');
      requests.shift()({ ok: true, json: async () => ({ schemaVersion: 1, observedAt: new Date().toISOString(),
        run: { id: 'fixture', mode: 'test', planHash: 'a'.repeat(64), warnings: [] }, events: [], edges,
        dispatches: ['openai', 'google'].map((vendor, index) => ({ id: 'd' + (index + 1), unitId: 'unit', vendor, model: 'fixture', role: index ? 'verify' : 'implement', status: 'PASS' })),
      }) });
      await new Promise(resolve => setImmediate(resolve));
    }
    const click = id => element(id).handlers.click();
    const visibility = hidden => { document.hidden = hidden; handlers.visibilitychange(); };
    const pulses = () => [...nodes.values()].some(node => node.classList.contains('handoff-pulse'));
    await answer([]);
    assert.equal(element('run-name').textContent, 'fixture / test', mode + ': initial render must succeed');
    if (mode === 'paused-refresh') {
      click('pause'); click('refresh'); await answer([]); click('pause'); await answer([first]);
    } else if (mode === 'hidden-response') {
      click('refresh'); visibility(true); await answer([]); visibility(false); await answer([first]);
    } else {
      click('refresh');
      if (mode === 'pause-pending') { click('pause'); click('pause'); } else { visibility(true); visibility(false); }
      await answer([first]);
    }
    assert.equal(pulses(), false, mode + ': interrupted response must not pulse');
    assert.equal(element('handoff-announcement').textContent, '', mode + ': interrupted response must not announce a new handoff');
    click('refresh'); await answer([first]); // Establish current observation after the interrupted response.
    assert.equal(pulses(), false, mode + ': unchanged catch-up must not pulse');
    click('refresh'); await answer([first, second]);
    assert.equal(pulses(), true, mode + ': the next continuous arrival must pulse');
    assert.equal(element('handoff-announcement').textContent, '1 new handoff recorded.', mode);
  }
});

test('failed attempts preserve codes; finalized NOT_RUN never becomes an attempted failure', t => {
  const run = fixture(t, [{}, { role: 'verify' }]);
  const state = run.state(0, 'FAIL');
  Object.assign(state.value, { completedAt: '2026-09-12T12:02:00.000Z', code: 'NATIVE_TIMEOUT', error: 'secret raw output must not escape' });
  write(state.file, state.value);
  write(path.join(run.runDir, 'run-summary.json'), { schemaVersion: 1, planId: run.plan.planId, planHash: run.seal.planHash, finalizedAt: '2026-09-12T12:03:00.000Z', executionStatus: 'FAIL', approvalStatus: 'FAIL', ok: false, units: [{ unitId: 'unit', status: 'FAIL', reason: 'Missing independent verification' }], outcomes: run.dispatches.map((entry, index) => ({ ...entry, planId: run.plan.planId, planHash: run.seal.planHash, status: index ? 'NOT_RUN' : 'FAIL' })) });
  const snapshot = createSnapshot(run.runDir);
  assert.deepEqual(snapshot.dispatches.map(row => row.status), ['FAIL', 'NOT_RUN']);
  assert.equal(snapshot.dispatches[0].issue, 'NATIVE_TIMEOUT');
  assert.equal(snapshot.dispatches[1].attempts.length, 0);
  assert.equal(snapshot.run.approvalStatus, 'RECORDED_FAIL');
  assert.ok(!JSON.stringify(snapshot).includes('secret raw output'));
  const summaryFile = path.join(run.runDir, 'run-summary.json');
  const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
  for (const mutation of [{ approvalStatus: 'PASS' }, { executionStatus: 'PASS' }, { ok: true }]) {
    write(summaryFile, { ...summary, ...mutation });
    const inconsistent = createSnapshot(run.runDir);
    assert.equal(inconsistent.run.approvalStatus, 'UNKNOWN', JSON.stringify(mutation));
    assert.ok(inconsistent.run.warnings.some(warning => warning.includes('disagrees')));
  }
});

test('partial PASS, mismatched seal, and stale summary cannot produce a successful observation', t => {
  const run = fixture(t);
  const state = run.state(0, 'PASS');
  let snapshot = createSnapshot(run.runDir);
  assert.equal(snapshot.dispatches[0].status, 'UNKNOWN');
  assert.equal(snapshot.run.executionStatus, 'UNKNOWN');
  write(path.join(run.runDir, 'run-summary.json'), { schemaVersion: 1, planId: run.plan.planId, planHash: run.seal.planHash, approvalStatus: 'PASS', finalizedAt: '2026-09-12T12:00:00Z', outcomes: [] });
  snapshot = createSnapshot(run.runDir);
  assert.equal(snapshot.run.approvalStatus, 'UNKNOWN');
  assert.ok(snapshot.run.warnings.some(warning => warning.includes('stale')));
  write(path.join(run.runDir, 'plan-seal.json'), { ...run.seal, planHash: '0'.repeat(64) });
  write(state.file, { ...state.value, status: 'RUNNING' });
  assert.equal(createSnapshot(run.runDir).dispatches[0].status, 'UNKNOWN');
});

test('malformed, oversized and hard-linked metadata fail closed', t => {
  const run = fixture(t);
  const state = run.state();
  fs.writeFileSync(state.file, '{"status":');
  assert.throws(() => createSnapshot(run.runDir), /malformed or incomplete/);
  fs.writeFileSync(state.file, ' '.repeat(LIMITS.fileBytes + 1));
  assert.throws(() => createSnapshot(run.runDir), /read limit/);
  fs.rmSync(state.file); const linked = path.join(run.root, 'outside.json'); write(linked, state.value); fs.linkSync(linked, state.file);
  assert.throws(() => createSnapshot(run.runDir), /unsafe/);
});

test('untrusted evidence paths and junction roots cannot read outside the selected run', t => {
  const run = fixture(t);
  const state = run.state();
  const outside = path.join(run.root, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'launch.json'), 'secret and malformed');
  write(state.file, { ...state.value, evidenceDir: outside });
  const snapshot = createSnapshot(run.runDir);
  assert.equal(snapshot.dispatches[0].status, 'UNKNOWN');
  assert.equal(snapshot.dispatches[0].issue, 'UNTRUSTED_EVIDENCE_PATH');
  const link = path.join(run.root, 'linked-run');
  try { fs.symlinkSync(run.runDir, link, 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.diagnostic('Symlink subcase NOT RUN: OS denies link creation.'); return; } throw error; }
  assert.throws(() => createSnapshot(link), /plain local directory/);
  fs.mkdirSync(path.dirname(state.evidenceDir), { recursive: true });
  fs.symlinkSync(outside, state.evidenceDir, 'dir');
  write(state.file, state.value);
  assert.equal(createSnapshot(run.runDir).dispatches[0].issue, 'UNTRUSTED_EVIDENCE_PATH');
});

test('network, device and traversal evidence paths are rejected before filesystem lookup', t => {
  const run = fixture(t); const state = run.state();
  const paths = ['//server/share/run/out/d1', '/dev/null/run/out/d1', '../../etc/run/out/d1', 'run/out/d1'];
  const traversalTarget = path.resolve(paths.at(-1));
  const lookups = [];
  const original = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', function (file, ...args) {
    if (typeof file === 'string' && (/^[\\/]{2}/.test(file) || file === traversalTarget)) {
      lookups.push(file);
      throw new Error('Blocked unexpected external path lookup in test');
    }
    return original.call(fs, file, ...args);
  });
  for (const evidenceDir of paths) {
    write(state.file, { ...state.value, evidenceDir });
    const snapshot = createSnapshot(run.runDir);
    assert.equal(snapshot.dispatches[0].status, 'UNKNOWN');
    assert.equal(snapshot.dispatches[0].issue, 'UNTRUSTED_EVIDENCE_PATH');
  }
  assert.deepEqual(lookups, [], 'Untrusted network/device/traversal paths must not reach filesystem lookup');
});

// (The interrupted-child recovery test from the feat/live-dashboard branch was dropped on 2026-09-16: that recovery protocol is not part of this runtime.)

test('HTTP observer updates state and rejects missing capability, hostile hosts, origins, methods and path tricks', async t => {
  const run = fixture(t); const dashboard = await serve(t, run.runDir);
  assert.equal(dashboard.server.address().address, '127.0.0.1');
  assert.match(dashboard.url, /\/#token=[A-Za-z0-9_-]{43}$/);
  let result = await request(dashboard);
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.body).dispatches[0].status, 'NOT_STARTED');
  run.state();
  const frozen = inventory(run.runDir);
  result = await request(dashboard);
  assert.equal(JSON.parse(result.body).dispatches[0].status, 'RUNNING');
  assert.deepEqual(inventory(run.runDir), frozen);
  assert.equal(result.headers['access-control-allow-origin'], undefined);
  assert.match(result.headers['content-security-policy'], /frame-ancestors 'none'/);
  for (const [options, expected] of [
    [{ headers: { Authorization: '' } }, 401], [{ headers: { Authorization: 'Bearer wrong' } }, 401],
    [{ headers: { Host: 'localhost' } }, 403], [{ headers: { Origin: 'https://evil.example' } }, 403],
    [{ headers: { Origin: 'null' } }, 403], [{ headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403],
    [{ method: 'POST' }, 405], [{ method: 'OPTIONS' }, 405],
    [{ route: '/api/snapshot?token=' + dashboard.token }, 404], [{ route: '/dispatch-plan.json' }, 404],
    [{ route: '/%2e%2e/dispatch-plan.json' }, 404],
  ]) assert.equal((await request(dashboard, options)).status, expected, JSON.stringify(options));
  assert.equal((await request(dashboard, { headers: { Origin: dashboard.origin, 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
});

test('API read errors produce safe non-200 JSON, never a stale successful snapshot', async t => {
  const run = fixture(t); const dashboard = await serve(t, run.runDir);
  assert.equal((await request(dashboard)).status, 200);
  fs.writeFileSync(path.join(run.runDir, 'dispatch-plan.json'), '{');
  const result = await request(dashboard);
  assert.equal(result.status, 503);
  const body = JSON.parse(result.body);
  assert.deepEqual(Object.keys(body), ['error']);
  assert.ok(!result.body.includes(run.runDir));
  assert.ok(!result.body.includes('Error:'));
});

test('CLI requires an explicit run and rejects extra controls and invalid ports', () => {
  assert.deepEqual(parseArgs(['--run-dir', 'run']), { runDir: 'run', port: 0 });
  assert.deepEqual(parseArgs(['--port', '8040', '--run-dir', 'run']), { runDir: 'run', port: 8040 });
  for (const args of [[], ['--run-dir'], ['--run-dir', 'run', '--host', '0.0.0.0'], ['--run-dir', 'run', '--port', '-1'], ['--run-dir', 'run', '--port', '65536'], ['--run-dir', 'run', '--run-dir', 'elsewhere']]) assert.throws(() => parseArgs(args));
});
