'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BENCHMARK_CATALOG, generateBenchmark, judgeBenchmark } = require('./benchmark-fixtures');

function fixture(t, taskId) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = generateBenchmark(taskId, path.join(root, 'product'));
  const packet = JSON.parse(fs.readFileSync(path.join(manifest.cwd, 'benchmark.json'), 'utf8'));
  return { manifest, packet, cwd: manifest.cwd, judge: response => judgeBenchmark(taskId, manifest.cwd, { manifest, response }) };
}

// Independent good implementations are test-only. Never part of a subject packet.
function goodImport(text) {
  const best = new Map(); const versions = new Map();
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const fail = () => { throw new Error(`line ${i + 1}: invalid ticket`); };
    let row; try { row = JSON.parse(line); } catch { fail(); }
    if (!row || Array.isArray(row) || typeof row !== 'object' || Object.keys(row).sort().join() !== 'id,priority,receivedOn,revision,status,title') fail();
    if (['id', 'title'].some(key => typeof row[key] !== 'string' || !row[key] || row[key].trim() !== row[key])) fail();
    if (!['new', 'waiting', 'closed'].includes(row.status) || !['high', 'medium', 'low'].includes(row.priority) || !Number.isSafeInteger(row.revision) || row.revision < 1) fail();
    if (typeof row.receivedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.receivedOn) || !Number.isFinite(Date.parse(row.receivedOn)) || new Date(row.receivedOn).toISOString().slice(0, 10) !== row.receivedOn) fail();
    const payload = JSON.stringify(Object.keys(row).sort().map(key => [key, row[key]]));
    const key = JSON.stringify([row.id, row.revision]);
    if (versions.has(key) && versions.get(key) !== payload) fail();
    versions.set(key, payload);
    if (!best.has(row.id) || best.get(row.id).revision < row.revision) best.set(row.id, row);
  });
  return [...best.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function goodDigest(rows, date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('invalid as-of date');
  if (rows.some(row => row.receivedOn > date)) throw new Error('future ticket');
  const counts = { new: 0, waiting: 0 }; const order = { high: 0, medium: 1, low: 2 };
  const tickets = rows.filter(row => row.status !== 'closed').map(row => {
    counts[row.status]++;
    return { id: row.id, title: row.title, status: row.status, priority: row.priority, ageDays: (Date.parse(date) - Date.parse(row.receivedOn)) / 86400000 };
  }).sort((a, b) => order[a.priority] - order[b.priority] || b.ageDays - a.ageDays || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { counts, tickets };
}
function goodRoster(state, command) {
  const invalid = () => { throw new Error('invalid command'); };
  if (!command || typeof command !== 'object' || Array.isArray(command) || !['join', 'cancel'].includes(command.type)) invalid();
  if (Object.keys(command).sort().join() !== (command.type === 'join' ? 'id,person,type' : 'id,type')) invalid();
  if (typeof command.id !== 'string' || !command.id || command.id.trim() !== command.id) invalid();
  if (command.type === 'join' && (typeof command.person !== 'string' || !command.person || command.person.trim() !== command.person)) invalid();
  const next = structuredClone(state); const existing = next.bookings.find(row => row.id === command.id);
  if (command.type === 'join') {
    if (existing && existing.person !== command.person) throw new Error('booking conflict');
    if (!existing) next.bookings.push({ id: command.id, person: command.person, status: 'waiting' });
  } else next.bookings = next.bookings.filter(row => row.id !== command.id);
  next.bookings.forEach((row, i) => { row.status = i < next.capacity ? 'confirmed' : 'waiting'; });
  return next;
}
function validRoster(state) {
  const fail = () => { throw new Error('invalid roster'); };
  if (!state || typeof state !== 'object' || Array.isArray(state) || Object.keys(state).sort().join() !== 'bookings,capacity,version' || state.version !== 1 || !Number.isSafeInteger(state.capacity) || state.capacity < 1 || !Array.isArray(state.bookings)) fail();
  const ids = new Set();
  state.bookings.forEach((row, i) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).sort().join() !== 'id,person,status') fail();
    if (['id', 'person'].some(key => typeof row[key] !== 'string' || !row[key] || row[key].trim() !== row[key])) fail();
    if (ids.has(row.id) || row.status !== (i < state.capacity ? 'confirmed' : 'waiting')) fail();
    ids.add(row.id);
  });
}
function goodLoad(file) {
  const state = JSON.parse(fs.readFileSync(file, 'utf8')); validRoster(state); return state;
}
function goodSave(file, state) {
  validRoster(state); const temporary = file + '.temporary';
  try { fs.writeFileSync(temporary, JSON.stringify(state) + '\n', 'utf8'); fs.renameSync(temporary, file); }
  catch (error) { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); throw error; }
}
function repairSoftware(f) {
  const write = (name, code) => fs.writeFileSync(path.join(f.cwd, 'src', name + '.cjs'), "'use strict';\n" + code);
  if (f.packet.size !== 'l') {
    write('import', goodImport.toString() + '\nexports.parseTickets=goodImport;\n');
    if (f.packet.size === 'm') write('digest', goodDigest.toString() + '\nexports.buildDigest=goodDigest;\n');
  } else {
    write('roster', goodRoster.toString() + '\nexports.applyCommand=goodRoster;\n');
    write('repository', "const fs=require('node:fs');\n" + [validRoster, goodLoad, goodSave].map(fn => fn.toString()).join('\n') + '\nexports.loadRoster=goodLoad;exports.saveRoster=goodSave;\n');
  }
}

function writingAnswer(packet) {
  const pad = (value, minimum) => value + ' Detail'.repeat(Math.max(0, minimum - value.trim().split(/\s+/).length));
  const sourceText = packet.sources.map(source => source.content).join(' ');
  const answer = Object.fromEntries(Object.entries(packet.acceptance.sections).map(([section, [minimum]]) => [section, pad(section === 'residents' ? packet.sources[0].content : sourceText, minimum)]));
  if (packet.size === 's') answer.facts = { branches: ['Pine', 'Elm'], start: '2026-10-05', end: '2026-10-30', free: true, phoneAvailable: true, keyboardRetest: 'pending', spanishScript: 'ready', frenchScript: 'pending' };
  else { answer.decision = 'proceed-conditionally'; answer.metrics = { completionAttemptPercent: 75, completionInvitedPercent: 50, surveyRespondentPercent: 80, totalCost: 1900, budgetHeadroom: 100, missingShifts: 2 }; }
  answer.claims = packet.sources.map(source => ({ text: source.content, sourceIds: [source.id] }));
  return answer;
}

function planningAnswer(packet) {
  const p = packet.planning;
  const starts = packet.size === 's' ? { A: 1, B: 2, C: 2, D: 3, E: 4 } : packet.size === 'm' ? { A: 1, B: 2, C: 2, D: 4, E: 4, F: 6, G: 8, H: 9 } : { A: 1, B: 2, C: 2, D: 4, E: 4, J: 2, K: 6, F: 7, G: 8, H: 9, L: 10, M: 11 };
  function schedule(startMap, repair = false) {
    const tasks = [...p.tasks, ...(repair ? [{ id: 'REPAIR', days: 1, resources: ['E1', 'E2'] }] : [])];
    return tasks.map(task => ({ id: task.id, start: p.calendar[startMap[task.id] - 1], end: p.calendar[startMap[task.id] + task.days - 2], resources: task.resources }));
  }
  const milestones = rows => p.milestoneTasks.map(taskId => ({ taskId, date: rows.find(row => row.id === taskId).end }));
  const rows = schedule(starts);
  const answer = { schedule: rows, cost: packet.size === 's' ? 0 : packet.size === 'm' ? 1240 : 1820, resourceDays: packet.size === 's' ? 5 : packet.size === 'm' ? 13 : 19, milestones: milestones(rows),
    risks: [{ trigger: 'Gate fails', action: 'Hold the successor', owner: Object.keys(p.resources)[0] }, { trigger: 'Staff unavailable', action: 'Use the stated scenario or hold launch', owner: Object.keys(p.resources)[0] }], assumptions: [], rationale: 'Use declared gates and the paired repair option if the build fails.', scenarios: [] };
  if (packet.size === 'm') {
    const next = schedule({ ...starts, F: 7 });
    answer.scenarios.push({ id: 'operator-absence', schedule: next, cost: 1240, resourceDays: 13, milestones: milestones(next) });
  }
  if (packet.size === 'l') {
    const tail = { K: 7, F: 8, G: 9, H: 10, L: 11, M: 12 };
    const delayed = schedule({ ...starts, ...tail, J: 5 });
    const repaired = schedule({ ...starts, ...tail, REPAIR: 6 }, true);
    answer.scenarios.push({ id: 'export-delay', schedule: delayed, cost: 1820, resourceDays: 19, milestones: milestones(delayed) }, { id: 'build-repair', schedule: repaired, cost: 2120, resourceDays: 21, milestones: milestones(repaired), repairMode: 'paired' });
  }
  return answer;
}

test('benchmark module exposes nine reproducible domain tasks', () => {
  const modulePath = path.join(__dirname, 'benchmark-fixtures.js');
  assert.ok(fs.existsSync(modulePath), 'benchmark generator is not implemented');
  const { BENCHMARK_CATALOG, generateBenchmark } = require(modulePath);
  assert.equal(BENCHMARK_CATALOG.length, 9);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-fixtures-'));
  try {
    for (const task of BENCHMARK_CATALOG) {
      const left = generateBenchmark(task.taskId, path.join(root, task.taskId + '-a'));
      const right = generateBenchmark(task.taskId, path.join(root, task.taskId + '-b'));
      assert.equal(left.packetSha256, right.packetSha256);
      assert.deepEqual(left.protectedHashes, right.protectedHashes);
      assert.equal(left.domain, task.domain);
      assert.equal(left.size, task.size);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const size of ['s', 'm', 'l']) {
  test('software-' + size + ' rejects seeded defects and accepts independent good implementation', t => {
    const f = fixture(t, 'software-' + size);
    const before = f.judge();
    assert.equal(before.deterministicPass, false);
    assert.ok(before.failures.some(row => row.id === 'software.tests'), JSON.stringify(before));
    assert.ok(before.checks.find(row => row.id === 'software.executed').pass, JSON.stringify(before));
    assert.deepEqual([...before.testRun.failedNames].sort(), [...f.manifest.baselineFailures].sort());
    assert.doesNotMatch(before.testRun.stdout + before.testRun.stderr, /SyntaxError|MODULE_NOT_FOUND/);
    repairSoftware(f);
    const after = f.judge();
    assert.equal(after.deterministicPass, true, JSON.stringify(after));
    assert.equal(after.qualityAccepted, null);
    assert.equal(after.nativeExecutionValidity, 'NOT_EVALUATED');
  });
  test('writing-' + size + ' accepts calibrated structure without awarding semantic quality', t => {
    const f = fixture(t, 'writing-' + size); const answer = writingAnswer(f.packet);
    const result = f.judge('Report follows.\n```json\n' + JSON.stringify(answer) + '\n```\n');
    assert.equal(result.deterministicPass, true, JSON.stringify(result.failures));
    assert.equal(result.semanticStatus, 'NOT_EVALUATED');
    assert.equal(result.qualityAccepted, null);
  });
  test('planning-' + size + ' accepts independently specified feasible witnesses', t => {
    const f = fixture(t, 'planning-' + size);
    const result = f.judge(planningAnswer(f.packet));
    assert.equal(result.deterministicPass, true, JSON.stringify(result.failures));
    assert.equal(result.semanticStatus, 'NOT_EVALUATED');
  });
}

test('generator refuses unsupported and reused destinations without changing bytes', t => {
  const f = fixture(t, 'writing-s'); const before = fs.readFileSync(path.join(f.cwd, 'benchmark.json'));
  assert.throws(() => generateBenchmark('writing-s', f.cwd), /exist/);
  assert.throws(() => generateBenchmark('bad', f.cwd + '-new'), /Unknown/);
  assert.throws(() => generateBenchmark('writing-s', 'relative'), /absolute/);
  assert.deepEqual(fs.readFileSync(path.join(f.cwd, 'benchmark.json')), before);
});

test('judge rejects missing manifest, packet mutation and extra product files', t => {
  const f = fixture(t, 'writing-s'); const answer = writingAnswer(f.packet);
  assert.equal(judgeBenchmark('writing-s', f.cwd, { response: answer }).deterministicPass, false);
  fs.writeFileSync(path.join(f.cwd, 'extra.json'), '{}');
  assert.equal(f.judge(answer).deterministicPass, false);
  fs.unlinkSync(path.join(f.cwd, 'extra.json'));
  fs.writeFileSync(path.join(f.cwd, 'benchmark.json'), '{}');
  assert.equal(f.judge(answer).deterministicPass, false);
});

test('software judge rejects protected edits, no-tests exit, and partial implementations', t => {
  const f = fixture(t, 'software-s');
  fs.writeFileSync(path.join(f.cwd, 'src/import.cjs'), 'process.exit(0);');
  assert.equal(f.judge().deterministicPass, false);
  repairSoftware(f);
  const good = fs.readFileSync(path.join(f.cwd, 'src/import.cjs'), 'utf8');
  fs.writeFileSync(path.join(f.cwd, 'src/import.cjs'), good.replace("if (versions.has(key) && versions.get(key) !== payload) fail();", ''));
  assert.equal(f.judge().deterministicPass, false);
  fs.writeFileSync(path.join(f.cwd, 'test/import.test.cjs'), '');
  const changed = f.judge();
  assert.equal(changed.deterministicPass, false);
  assert.equal(changed.testRun, undefined);
});

test('writing judge rejects malformed delivery, wrong arithmetic, citations and field shapes', t => {
  const f = fixture(t, 'writing-m'); const good = writingAnswer(f.packet);
  for (const mutate of [
    row => { row.metrics.completionAttemptPercent = 50; },
    row => { row.metrics.totalCost = null; },
    row => { row.metrics.missingShifts = -2; },
    row => { row.claims[0].sourceIds = ['F99']; },
    row => { row.claims[0].text = 'Not an actual output span'; },
    row => { row.claims = []; },
    row => { row.memo = 'too short'; },
    row => { row.extra = true; },
    row => { row.claims[0].sourceIds = ['F01', 'F01']; },
  ]) { const bad = structuredClone(good); mutate(bad); assert.equal(f.judge(bad).deterministicPass, false); }
  for (const response of [JSON.stringify(good), '```json\n[]\n```', '```json\n{}\n```\n```json\n{}\n```', '```json\n{bad}\n```']) assert.equal(f.judge(response).deterministicPass, false);
  const misleading = structuredClone(good); misleading.memo += ' The retention audit is complete.';
  const result = f.judge(misleading);
  assert.equal(result.deterministicPass, true, 'Prose entailment is explicitly outside the mechanical judge');
  assert.equal(result.qualityAccepted, null);
});

test('planning judge catches duration, dependency, resource, calendar, cost and gate violations', t => {
  const f = fixture(t, 'planning-m'); const good = planningAnswer(f.packet);
  for (const mutate of [
    row => { row.schedule.pop(); },
    row => { row.schedule[1] = structuredClone(row.schedule[0]); },
    row => { row.schedule[1].end = row.schedule[1].start; },
    row => { row.schedule[1].start = '2026-09-12'; },
    row => { row.schedule[0].start = row.schedule[0].end = '2026-09-16'; },
    row => { row.schedule.find(item => item.id === 'G').start = row.schedule.find(item => item.id === 'G').end = '2026-09-22'; },
    row => { row.schedule.find(item => item.id === 'F').resources = ['E']; },
    row => { row.cost = 0; },
    row => { row.resourceDays = 8; },
    row => { row.milestones[0].date = '2026-09-25'; },
    row => { row.scenarios = []; },
    row => { row.scenarios[0].schedule = structuredClone(row.schedule); },
    row => { row.risks[0].owner = 'extra-person'; },
  ]) { const bad = structuredClone(good); mutate(bad); assert.equal(f.judge(bad).deterministicPass, false, JSON.stringify(bad)); }
});

test('long planning judge catches missing surcharge, fake repair, and export-delay reuse', t => {
  const f = fixture(t, 'planning-l'); const good = planningAnswer(f.packet);
  for (const mutate of [
    row => { row.scenarios[1].cost -= 100; },
    row => { row.scenarios[1].repairMode = 'instant'; },
    row => { row.scenarios[1].schedule = row.scenarios[1].schedule.filter(item => item.id !== 'REPAIR'); },
    row => { row.scenarios[0].schedule = structuredClone(row.schedule); },
    row => { row.scenarios[1].repairMode = 'solo'; },
    row => { row.scenarios.push(structuredClone(row.scenarios[0])); },
  ]) { const bad = structuredClone(good); mutate(bad); assert.equal(f.judge(bad).deterministicPass, false); }
});

test('fixture inventory rejects hard-linked inputs and altered external manifest scope', t => {
  const f = fixture(t, 'writing-s');
  fs.linkSync(path.join(f.cwd, 'benchmark.json'), path.join(path.dirname(f.cwd), 'packet-link.json'));
  const linked = f.judge(writingAnswer(f.packet));
  assert.equal(linked.deterministicPass, false);
  assert.ok(linked.failures.some(row => /Non-plain/.test(row.detail)));
  fs.unlinkSync(path.join(path.dirname(f.cwd), 'packet-link.json'));
  const manifest = structuredClone(f.manifest); manifest.writeScope = ['benchmark.json'];
  assert.equal(judgeBenchmark('writing-s', f.cwd, { manifest, response: writingAnswer(f.packet) }).deterministicPass, false);
});

test('generated packets contain no reference answers or test-only implementations', t => {
  for (const task of BENCHMARK_CATALOG) {
    const f = fixture(t, task.taskId);
    for (const file of f.manifest.files) {
      const content = fs.readFileSync(path.join(f.cwd, file.path), 'utf8');
      assert.doesNotMatch(content, /goodImport|goodDigest|goodRoster|repairSoftware|planningAnswer|writingAnswer/);
    }
    assert.equal(f.packet.acceptance.semanticReviewRequired, true);
    if (task.domain !== 'software') assert.deepEqual(f.manifest.writeScope, []);
  }
});

test('planning deadline and overlapping shared resources fail independently', t => {
  const f = fixture(t, 'planning-s');
  const late = planningAnswer(f.packet); late.schedule.find(row => row.id === 'E').start = late.schedule.find(row => row.id === 'E').end = '2026-09-18';
  late.milestones.find(row => row.taskId === 'E').date = '2026-09-18';
  assert.ok(f.judge(late).failures.some(row => row.id === 'planning.baseline.deadline'));
  const conflict = planningAnswer(f.packet); conflict.schedule.find(row => row.id === 'D').start = conflict.schedule.find(row => row.id === 'D').end = '2026-09-15';
  assert.ok(f.judge(conflict).failures.some(row => row.id.startsWith('planning.baseline.occupancy')));
});

test('generator refuses a real junction ancestor before writing into its target', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-junction-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'target'); const linked = path.join(root, 'link');
  fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'keep.txt'), 'unchanged');
  fs.symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  for (const taskId of ['software-s', 'writing-s', 'planning-s']) {
    assert.throws(() => generateBenchmark(taskId, path.join(linked, taskId)), /symlink|junction/i);
    assert.deepEqual(fs.readdirSync(target), ['keep.txt']);
    assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'unchanged');
  }
});

test('judge imposes no unpublished maximum on valid claims or risks', t => {
  const writing = fixture(t, 'writing-s');
  for (const count of [100, 101]) {
    const answer = writingAnswer(writing.packet);
    while (answer.claims.length < count) answer.claims.push(structuredClone(answer.claims[0]));
    assert.equal(writing.judge(answer).deterministicPass, true);
  }
  const planning = fixture(t, 'planning-s');
  for (const count of [20, 21]) {
    const answer = planningAnswer(planning.packet);
    while (answer.risks.length < count) answer.risks.push(structuredClone(answer.risks[0]));
    assert.equal(planning.judge(answer).deterministicPass, true);
  }
});
