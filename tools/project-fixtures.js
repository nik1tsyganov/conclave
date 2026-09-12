'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// These are deliberately faulty starting products, not reference solutions.
const definitions = {
  'ticket-digest': {
    title: 'Ticket Digest',
    usage: 'node bin/cli.cjs examples/tickets.ndjson --as-of 2026-09-11',
    contract: String.raw`Read local ticket updates and print one JSON digest followed by a newline.
CLI syntax: node bin/cli.cjs INPUT --as-of YYYY-MM-DD. Errors go to stderr, exit 1, with no stdout.
parseTickets(text) returns tickets sorted by ID (code-unit order). Ignore blank lines.
Each JSON line has exactly id, title, status, priority, revision, receivedOn.
id and title are nonempty trimmed strings; preserve Unicode. status is new/waiting/closed.
priority is high/medium/low. revision is a positive safe integer. receivedOn is a real YYYY-MM-DD date.
Reject bad JSON, invalid records, or conflicting payloads at the same ID/revision with Error('line N: invalid ticket').
Identical repeated records are allowed. Keep the highest revision for each ID regardless of input order.
buildDigest(tickets, asOfDate) accepts validated tickets, rejects invalid asOfDate and future receivedOn dates.
It returns {counts:{new:N,waiting:N},tickets:[{id,title,status,priority,ageDays}]}.
Exclude closed tickets. ageDays is the integer UTC-day difference from receivedOn to asOfDate.
Sort high/medium/low, then ageDays descending, then ID ascending by code-unit order.
Do not mutate the input array or any ticket object. No current clock, network, or external packages.
Only src/import.cjs and src/digest.cjs may change. CLI, contracts, examples, and tests are protected.
`,
    units: [
      { id: 'import', failures: ['import keeps highest revision', 'import rejects malformed JSON with line number'] },
      { id: 'digest', failures: ['digest excludes closed tickets', 'digest orders priority then age then ID', 'digest leaves input unchanged'] },
    ],
    integrationFailures: ['CLI renders the complete ticket digest', 'CLI rejects malformed input without stdout'],
    exampleName: 'tickets.ndjson',
    example: '{"id":"T1","title":"Printer offline","status":"new","priority":"high","revision":1,"receivedOn":"2026-09-09"}\n{"id":"T2","title":"Badge issued","status":"closed","priority":"low","revision":1,"receivedOn":"2026-09-10"}\n',
    emptyName: 'empty.ndjson', empty: '',
    modules: [String.raw`'use strict';
function parseTickets(text) {
  const chosen = new Map();
  const seen = new Map();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let ticket;
    try { ticket = JSON.parse(line); } catch { continue; }
    const invalid = () => { throw new Error('line ' + (index + 1) + ': invalid ticket'); };
    if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) invalid();
    if (Object.keys(ticket).sort().join(',') !== 'id,priority,receivedOn,revision,status,title') invalid();
    for (const key of ['id', 'title']) if (typeof ticket[key] !== 'string' || !ticket[key].trim() || ticket[key] !== ticket[key].trim()) invalid();
    if (!['new', 'waiting', 'closed'].includes(ticket.status) || !['high', 'medium', 'low'].includes(ticket.priority)) invalid();
    if (!Number.isSafeInteger(ticket.revision) || ticket.revision < 1) invalid();
    if (typeof ticket.receivedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ticket.receivedOn) || !Number.isFinite(Date.parse(ticket.receivedOn)) || new Date(ticket.receivedOn).toISOString().slice(0, 10) !== ticket.receivedOn) invalid();
    const normalized = { id: ticket.id, title: ticket.title, status: ticket.status, priority: ticket.priority, revision: ticket.revision, receivedOn: ticket.receivedOn };
    const key = JSON.stringify([ticket.id, ticket.revision]);
    const payload = JSON.stringify(normalized);
    if (seen.has(key) && seen.get(key) !== payload) invalid();
    seen.set(key, payload);
    if (!chosen.has(ticket.id)) chosen.set(ticket.id, normalized);
  }
  return [...chosen.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
module.exports = { parseTickets };
`, String.raw`'use strict';
function buildDigest(tickets, asOfDate) {
  if (typeof asOfDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) || !Number.isFinite(Date.parse(asOfDate)) || new Date(asOfDate).toISOString().slice(0, 10) !== asOfDate) throw new Error('invalid as-of date');
  if (tickets.some(ticket => ticket.receivedOn > asOfDate)) throw new Error('future ticket');
  const counts = { new: 0, waiting: 0 };
  const result = tickets.sort((a, b) => a.priority < b.priority ? -1 : a.priority > b.priority ? 1 : a.receivedOn < b.receivedOn ? -1 : a.receivedOn > b.receivedOn ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(ticket => {
    if (ticket.status in counts) counts[ticket.status] += 1;
    return { id: ticket.id, title: ticket.title, status: ticket.status, priority: ticket.priority, ageDays: (Date.parse(asOfDate) - Date.parse(ticket.receivedOn)) / 86400000 };
  });
  return { counts, tickets: result };
}
module.exports = { buildDigest };
`],
    cli: String.raw`'use strict';
const fs = require('node:fs');
const { parseTickets } = require('../src/import.cjs');
const { buildDigest } = require('../src/digest.cjs');
try {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[1] !== '--as-of') throw new Error('usage: INPUT --as-of YYYY-MM-DD');
  const output = buildDigest(parseTickets(fs.readFileSync(args[0], 'utf8')), args[2]);
  process.stdout.write(JSON.stringify(output) + '\n');
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
`,
    tests: [String.raw`'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTickets } = require('../src/import.cjs');
const ticket = (changes = {}) => ({ id: 'T1', title: 'Printer', status: 'new', priority: 'high', revision: 1, receivedOn: '2026-09-09', ...changes });
const lines = (...records) => records.map(JSON.stringify).join('\n');
test('import keeps highest revision', () => {
  assert.deepEqual(parseTickets(lines(ticket(), ticket({ revision: 3, status: 'closed' }), ticket({ revision: 2 }))), [ticket({ revision: 3, status: 'closed' })]);
});
test('import rejects malformed JSON with line number', () => assert.throws(() => parseTickets(lines(ticket()) + '\n{broken'), /^Error: line 2: invalid ticket$/));
test('import accepts empty and blank input', () => assert.deepEqual(parseTickets(' \n\r\n'), []));
test('import accepts identical revisions in different key order', () => assert.deepEqual(parseTickets(lines(ticket(), Object.fromEntries(Object.entries(ticket()).reverse()))), [ticket()]));
test('import rejects conflicting equal revisions', () => assert.throws(() => parseTickets(lines(ticket(), ticket({ title: 'Changed' }))), /line 2: invalid ticket/));
test('import preserves Unicode and sorts IDs', () => assert.deepEqual(parseTickets(lines(ticket({ id: 'Z', title: '東京 café' }), ticket({ id: 'A' }))).map(t => [t.id, t.title]), [['A', 'Printer'], ['Z', '東京 café']]));
test('import validates every record field and real dates', () => {
  for (const bad of [null, [], {}, ticket({ id: '' }), ticket({ title: ' padded ' }), ticket({ status: 'unknown' }), ticket({ priority: 'urgent' }), ticket({ revision: 0 }), ticket({ revision: 1.5 }), ticket({ receivedOn: '2026-02-30' }), ticket({ receivedOn: '2026-9-01' }), ticket({ extra: true })]) assert.throws(() => parseTickets(lines(bad)), /line 1: invalid ticket/);
});
test('import accepts leap day and CRLF', () => assert.equal(parseTickets('\r\n' + lines(ticket({ receivedOn: '2024-02-29' })) + '\r\n')[0].receivedOn, '2024-02-29'));
`, String.raw`'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDigest } = require('../src/digest.cjs');
const ticket = (changes = {}) => ({ id: 'T1', title: 'Printer', status: 'new', priority: 'high', revision: 1, receivedOn: '2026-09-09', ...changes });
test('digest excludes closed tickets', () => assert.deepEqual(buildDigest([ticket({ status: 'closed' })], '2026-09-11'), { counts: { new: 0, waiting: 0 }, tickets: [] }));
test('digest orders priority then age then ID', () => {
  const input = [ticket({ id: 'L', priority: 'low' }), ticket({ id: 'M', priority: 'medium' }), ticket({ id: 'B' }), ticket({ id: 'A' }), ticket({ id: 'Y', receivedOn: '2026-09-10' })];
  assert.deepEqual(buildDigest(input, '2026-09-11').tickets.map(t => t.id), ['A', 'B', 'Y', 'M', 'L']);
});
test('digest leaves input unchanged', () => {
  const input = [ticket({ id: 'Z', priority: 'low' }), ticket({ id: 'A' })];
  const before = structuredClone(input);
  buildDigest(input, '2026-09-11');
  assert.deepEqual(input, before);
});
test('digest reports exact fields and counts', () => assert.deepEqual(buildDigest([ticket({ status: 'waiting' })], '2026-09-11'), { counts: { new: 0, waiting: 1 }, tickets: [{ id: 'T1', title: 'Printer', status: 'waiting', priority: 'high', ageDays: 2 }] }));
test('digest accepts empty input', () => assert.deepEqual(buildDigest([], '2026-09-11'), { counts: { new: 0, waiting: 0 }, tickets: [] }));
test('digest counts UTC days across leap and year boundaries', () => {
  assert.equal(buildDigest([ticket({ receivedOn: '2024-02-28' })], '2024-03-01').tickets[0].ageDays, 2);
  assert.equal(buildDigest([ticket({ receivedOn: '2025-12-31' })], '2026-01-01').tickets[0].ageDays, 1);
  assert.equal(buildDigest([ticket()], '2026-09-09').tickets[0].ageDays, 0);
});
test('digest rejects invalid dates', () => { for (const value of ['', '2026-02-30', '2026-9-11', null]) assert.throws(() => buildDigest([], value), /invalid as-of date/); });
test('digest rejects future tickets', () => assert.throws(() => buildDigest([ticket()], '2026-09-08'), /future ticket/));
`],
    integration: String.raw`'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const run = (...args) => spawnSync(process.execPath, [path.join(__dirname, '../bin/cli.cjs'), ...args], { encoding: 'utf8' });
test('CLI renders the complete ticket digest', () => {
  const result = run(path.join(__dirname, '../examples/tickets.ndjson'), '--as-of', '2026-09-11');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, JSON.stringify({ counts: { new: 1, waiting: 0 }, tickets: [{ id: 'T1', title: 'Printer offline', status: 'new', priority: 'high', ageDays: 2 }] }) + '\n');
});
test('CLI rejects malformed input without stdout', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-acceptance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'bad.ndjson'); fs.writeFileSync(file, '{broken\n');
  const result = run(file, '--as-of', '2026-09-11');
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, 'line 1: invalid ticket\n');
});
test('CLI accepts empty input and rejects bad arguments', () => {
  assert.equal(run(path.join(__dirname, '../examples/empty.ndjson'), '--as-of', '2026-09-11').stdout, '{"counts":{"new":0,"waiting":0},"tickets":[]}\n');
  const bad = run(); assert.equal(bad.status, 1); assert.equal(bad.stdout, ''); assert.match(bad.stderr, /usage:/);
});
`,
  },
  'workshop-roster': {
    title: 'Workshop Roster',
    usage: 'node bin/cli.cjs examples/roster.json list',
    contract: String.raw`Manage one workshop with a local JSON file. One sequential operator; concurrent writers are outside this contract.
CLI: node bin/cli.cjs FILE list | join ID PERSON | cancel ID. PERSON is one quoted argument.
Success prints the resulting state as compact JSON plus newline. list never writes.
Errors print a message to stderr, exit 1, and emit no stdout. Invalid commands never save.
State has exactly {version:1,capacity:positive safe integer,bookings:[{id,person,status}]}.
IDs and people are nonempty trimmed strings. IDs are unique. Status is confirmed/waiting.
Confirmed count must not exceed capacity. No waiting booking may exist while a seat is free.
Array order records arrival order. Removing a booking preserves relative order of the survivors.
Confirmed bookings must precede waiting bookings in that order. A confirmed booking after any waiting booking is invalid.
applyCommand(state,{type:'join',id,person}) joins confirmed if space exists, otherwise waiting.
Repeating the same ID/person is idempotent. Reusing an ID for another person throws 'booking conflict'.
applyCommand(state,{type:'cancel',id}) removes that booking and promotes the earliest waiting booking if space opens.
Cancelling an unknown ID is an idempotent no-op. Bad commands throw. Never mutate the input state.
loadRoster(file) validates the exact shape and invariants above. Missing files, invalid JSON and invalid states throw.
saveRoster(file,state) validates state before any write. Publish valid JSON plus newline by a same-directory temporary file and rename.
On write or rename failure, throw and preserve the previous file bytes. Remove temporary debris on failure.
Only src/roster.cjs and src/repository.cjs may change. CLI, contracts, examples, and tests are protected.
`,
    units: [
      { id: 'roster', failures: ['roster repeats identical joins without consuming seats', 'roster promotes the earliest waiting booking'] },
      { id: 'repository', failures: ['repository rejects malformed JSON', 'repository preserves previous bytes on publication failure', 'repository preserves previous bytes on write failure', 'repository rejects confirmed bookings after waiting before any write'] },
    ],
    integrationFailures: ['CLI survives restart with idempotent joins and FIFO promotion', 'CLI refuses corrupted persisted data'],
    exampleName: 'roster.json', example: '{"version":1,"capacity":1,"bookings":[{"id":"booking-03","person":"Alex Kim","status":"confirmed"}]}\n',
    emptyName: 'empty.json', empty: '{"version":1,"capacity":1,"bookings":[]}\n',
    modules: [String.raw`'use strict';
function applyCommand(state, command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw new Error('invalid command');
  if (!['join', 'cancel'].includes(command.type) || typeof command.id !== 'string' || !command.id.trim() || command.id !== command.id.trim()) throw new Error('invalid command');
  if (Object.keys(command).sort().join(',') !== (command.type === 'join' ? 'id,person,type' : 'id,type')) throw new Error('invalid command');
  const next = structuredClone(state);
  if (command.type === 'join') {
    if (typeof command.person !== 'string' || !command.person.trim() || command.person !== command.person.trim()) throw new Error('invalid command');
    const existing = next.bookings.find(b => b.id === command.id);
    if (existing && existing.person !== command.person) throw new Error('booking conflict');
    const status = next.bookings.filter(b => b.status === 'confirmed').length < next.capacity ? 'confirmed' : 'waiting';
    next.bookings.push({ id: command.id, person: command.person, status });
  } else {
    next.bookings = next.bookings.filter(b => b.id !== command.id);
    if (next.bookings.filter(b => b.status === 'confirmed').length < next.capacity) {
      const waiting = [...next.bookings].reverse().find(b => b.status === 'waiting');
      if (waiting) waiting.status = 'confirmed';
    }
  }
  return next;
}
module.exports = { applyCommand };
`, String.raw`'use strict';
const fs = require('node:fs');
function validate(state) {
  const fail = () => { throw new Error('invalid roster'); };
  if (!state || typeof state !== 'object' || Array.isArray(state) || Object.keys(state).sort().join(',') !== 'bookings,capacity,version' || state.version !== 1 || !Number.isSafeInteger(state.capacity) || state.capacity < 1 || !Array.isArray(state.bookings)) fail();
  const ids = new Set(); let confirmed = 0; let waiting = 0;
  for (const booking of state.bookings) {
    if (!booking || typeof booking !== 'object' || Array.isArray(booking) || Object.keys(booking).sort().join(',') !== 'id,person,status') fail();
    for (const key of ['id', 'person']) if (typeof booking[key] !== 'string' || !booking[key].trim() || booking[key] !== booking[key].trim()) fail();
    if (ids.has(booking.id) || !['confirmed', 'waiting'].includes(booking.status)) fail();
    ids.add(booking.id); if (booking.status === 'confirmed') confirmed++; else waiting++;
  }
  if (confirmed > state.capacity || (waiting && confirmed < state.capacity)) fail();
}
function loadRoster(file) {
  const text = fs.readFileSync(file, 'utf8'); let state;
  try { state = JSON.parse(text); } catch { state = { version: 1, capacity: 1, bookings: [] }; }
  validate(state); return state;
}
function saveRoster(file, state) {
  validate(state);
  fs.writeFileSync(file, JSON.stringify(state) + '\n', 'utf8');
}
module.exports = { loadRoster, saveRoster };
`],
    cli: String.raw`'use strict';
const { applyCommand } = require('../src/roster.cjs');
const { loadRoster, saveRoster } = require('../src/repository.cjs');
try {
  const [file, verb, ...args] = process.argv.slice(2);
  if (!file || !((verb === 'list' && args.length === 0) || (verb === 'join' && args.length === 2) || (verb === 'cancel' && args.length === 1))) throw new Error('usage: FILE list | join ID PERSON | cancel ID');
  let state = loadRoster(file);
  if (verb !== 'list') { state = applyCommand(state, { type: verb, id: args[0], ...(verb === 'join' ? { person: args[1] } : {}) }); saveRoster(file, state); }
  process.stdout.write(JSON.stringify(state) + '\n');
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
`,
    tests: [String.raw`'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyCommand } = require('../src/roster.cjs');
const empty = () => ({ version: 1, capacity: 1, bookings: [] });
const join = (state, id, person = id) => applyCommand(state, { type: 'join', id, person });
test('roster repeats identical joins without consuming seats', () => { const state = join(empty(), 'A'); assert.deepEqual(join(state, 'A'), state); });
test('roster promotes the earliest waiting booking', () => {
  const state = join(join(join(empty(), 'A'), 'B'), 'C');
  assert.deepEqual(applyCommand(state, { type: 'cancel', id: 'A' }).bookings, [{ id: 'B', person: 'B', status: 'confirmed' }, { id: 'C', person: 'C', status: 'waiting' }]);
});
test('roster fills seats then waitlists', () => assert.deepEqual(join(join(empty(), 'A'), 'B').bookings.map(b => b.status), ['confirmed', 'waiting']));
test('roster rejects conflicting identity', () => assert.throws(() => join(join(empty(), 'A'), 'A', 'Another'), /booking conflict/));
test('roster never mutates input', () => { const state = join(empty(), 'A'); const before = structuredClone(state); join(state, 'B'); applyCommand(state, { type: 'cancel', id: 'A' }); assert.deepEqual(state, before); });
test('roster ignores missing cancellations', () => { const state = join(empty(), 'A'); assert.deepEqual(applyCommand(state, { type: 'cancel', id: 'missing' }), state); });
test('roster removes waiting bookings without replacing confirmed people', () => assert.deepEqual(applyCommand(join(join(empty(), 'A'), 'B'), { type: 'cancel', id: 'B' }), join(empty(), 'A')));
test('roster validates commands', () => { for (const command of [null, {}, { type: 'erase', id: 'A' }, { type: 'cancel', id: ' A' }, { type: 'join', id: 'A', person: '' }, { type: 'join', id: 'A', person: 'A', extra: 1 }]) assert.throws(() => applyCommand(empty(), command), /invalid command/); });
test('roster supports multiple seats and Unicode names', () => { const state = join(join({ ...empty(), capacity: 2 }, 'A', '東京 café'), 'B'); assert.deepEqual(state.bookings.map(b => b.status), ['confirmed', 'confirmed']); assert.equal(state.bookings[0].person, '東京 café'); });
`, String.raw`'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadRoster, saveRoster } = require('../src/repository.cjs');
const empty = { version: 1, capacity: 1, bookings: [] };
const booking = { id: 'A', person: 'Alex', status: 'confirmed' };
function setup(t, text = JSON.stringify(empty) + '\n') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-acceptance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'roster.json'); fs.writeFileSync(file, text); return { root, file, text };
}
test('repository rejects malformed JSON', t => { const { file } = setup(t, '{broken\n'); assert.throws(() => loadRoster(file)); });
test('repository preserves previous bytes on publication failure', t => {
  const { root, file, text } = setup(t); const original = fs.renameSync;
  fs.renameSync = () => { throw new Error('simulated rename failure'); };
  try { assert.throws(() => saveRoster(file, { ...empty, bookings: [booking] }), /simulated rename failure/); }
  finally { fs.renameSync = original; }
  assert.equal(fs.readFileSync(file, 'utf8'), text); assert.deepEqual(fs.readdirSync(root), ['roster.json']);
});
test('repository preserves previous bytes on write failure', t => {
  const { root, file, text } = setup(t); const original = fs.writeFileSync;
  fs.writeFileSync = (target) => { original(target, 'partial'); throw new Error('simulated write failure'); };
  try { assert.throws(() => saveRoster(file, { ...empty, bookings: [booking] }), /simulated write failure/); }
  finally { fs.writeFileSync = original; }
  assert.equal(fs.readFileSync(file, 'utf8'), text); assert.deepEqual(fs.readdirSync(root), ['roster.json']);
});
test('repository round trips exact state with newline and no debris', t => {
  const { root, file } = setup(t); const state = { ...empty, bookings: [{ ...booking, person: '東京 café' }] };
  saveRoster(file, state); assert.deepEqual(loadRoster(file), state); assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(state) + '\n'); assert.deepEqual(fs.readdirSync(root), ['roster.json']);
});
test('repository rejects missing files', t => { const { root } = setup(t); assert.throws(() => loadRoster(path.join(root, 'missing.json')), /ENOENT/); });
test('repository validates persisted shapes and occupancy', t => {
  const { file } = setup(t);
  for (const state of [null, [], {}, { ...empty, version: 2 }, { ...empty, capacity: 0 }, { ...empty, capacity: 1.5 }, { ...empty, extra: true }, { ...empty, bookings: [null] }, { ...empty, bookings: [{ ...booking, person: ' ' }] }, { ...empty, bookings: [{ ...booking, status: 'waiting' }] }, { ...empty, bookings: [booking, { ...booking, id: 'B' }] }, { ...empty, capacity: 2, bookings: [booking, booking] }]) {
    fs.writeFileSync(file, JSON.stringify(state)); assert.throws(() => loadRoster(file), /invalid roster/);
  }
});
test('repository validates before writing', t => { const { file, text } = setup(t); assert.throws(() => saveRoster(file, { ...empty, capacity: 0 }), /invalid roster/); assert.equal(fs.readFileSync(file, 'utf8'), text); });
test('repository rejects confirmed bookings after waiting before any write', t => {
  const invalid = { ...empty, bookings: [{ ...booking, status: 'waiting' }, { ...booking, id: 'B' }] };
  const source = setup(t, JSON.stringify(invalid) + '\n'); const destination = setup(t);
  const rejection = fn => { try { fn(); return null; } catch (error) { return error.message; } };
  const loadError = rejection(() => loadRoster(source.file));
  let writes = 0; const original = fs.writeFileSync;
  fs.writeFileSync = () => { writes++; throw new Error('unexpected write'); };
  let saveError;
  try { saveError = rejection(() => saveRoster(destination.file, invalid)); }
  finally { fs.writeFileSync = original; }
  assert.deepEqual({ loadError, saveError, writes }, { loadError: 'invalid roster', saveError: 'invalid roster', writes: 0 });
  for (const { root, file, text } of [source, destination]) {
    assert.equal(fs.readFileSync(file, 'utf8'), text); assert.deepEqual(fs.readdirSync(root), ['roster.json']);
  }
});
`],
    integration: String.raw`'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function setup(t, text) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'roster.json'); fs.writeFileSync(file, text || fs.readFileSync(path.join(__dirname, '../examples/empty.json')));
  const run = (...args) => spawnSync(process.execPath, [path.join(__dirname, '../bin/cli.cjs'), file, ...args], { encoding: 'utf8' });
  return { file, run };
}
test('CLI survives restart with idempotent joins and FIFO promotion', t => {
  const { file, run } = setup(t);
  for (const id of ['A', 'A', 'B', 'C']) { const result = run('join', id, id); assert.equal(result.status, 0, result.stderr); }
  const result = run('cancel', 'A'); assert.equal(result.status, 0, result.stderr);
  const expected = { version: 1, capacity: 1, bookings: [{ id: 'B', person: 'B', status: 'confirmed' }, { id: 'C', person: 'C', status: 'waiting' }] };
  assert.equal(result.stdout, JSON.stringify(expected) + '\n'); assert.equal(run('list').stdout, result.stdout); assert.deepEqual(JSON.parse(fs.readFileSync(file)), expected);
});
test('CLI refuses corrupted persisted data', t => { const { file, run } = setup(t, '{broken\n'); const result = run('join', 'A', 'Alex'); assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.ok(result.stderr.trim()); assert.equal(fs.readFileSync(file, 'utf8'), '{broken\n'); });
test('CLI list and invalid commands preserve persisted bytes', t => {
  const { file, run } = setup(t); const before = fs.readFileSync(file, 'utf8');
  assert.equal(run('list').status, 0); assert.equal(fs.readFileSync(file, 'utf8'), before);
  for (const args of [[], ['join', 'A'], ['join', 'A', ''], ['erase', 'A']]) { const result = run(...args); assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.ok(result.stderr.trim()); assert.equal(fs.readFileSync(file, 'utf8'), before); }
});
`,
  },
};

const PROJECT_IDS = Object.freeze(Object.keys(definitions));

function generateFixture(project, destination) {
  if (!PROJECT_IDS.includes(project)) throw new Error('Unknown project: ' + project);
  if (typeof destination !== 'string' || !path.isAbsolute(destination)) throw new Error('Destination must be absolute');
  if (fs.existsSync(destination)) throw new Error('Destination must not exist');
  const definition = definitions[project];
  const units = definition.units.map((unit, index) => ({
    id: unit.id,
    modulePath: 'src/' + unit.id + '.cjs',
    writeScope: ['src/' + unit.id + '.cjs'],
    testPath: 'test/' + unit.id + '.test.cjs',
    testArgs: ['--test', '--test-reporter=tap', 'test/' + unit.id + '.test.cjs'],
    baselineFailures: [...unit.failures],
  }));
  const testArgs = ['--test', '--test-reporter=tap', ...units.map(unit => unit.testPath), 'test/cli.test.cjs'];
  const files = {
    'package.json': JSON.stringify({ name: project, private: true, version: '1.0.0', scripts: { test: 'node ' + testArgs.join(' '), ...Object.fromEntries(units.map(unit => ['test:' + unit.id, 'node ' + unit.testArgs.join(' ')])) } }, null, 2) + '\n',
    'README.md': '# ' + definition.title + '\n\n' + definition.usage + '\n\nRead CONTRACT.md before changing code. Run npm test without installing packages.\nRun npm run test:' + units[0].id + ' and npm run test:' + units[1].id + ' for independent unit checks.\nThe initial version contains seeded defects. Acceptance tests must stay unchanged.\nImplement the two units in order. Freeze all product files before foreign verification and review.\nThe host runs acceptance and saves the test output and product hashes. Read-only seats inspect that saved evidence.\n',
    'CONTRACT.md': definition.contract,
    'bin/cli.cjs': definition.cli,
    [units[0].modulePath]: definition.modules[0],
    [units[1].modulePath]: definition.modules[1],
    [units[0].testPath]: definition.tests[0],
    [units[1].testPath]: definition.tests[1],
    'test/cli.test.cjs': definition.integration,
    ['examples/' + definition.exampleName]: definition.example,
    ['examples/' + definition.emptyName]: definition.empty,
  };
  // mkdir without recursive keeps the caller responsible for the scratch parent.
  fs.mkdirSync(destination);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' });
  }
  return {
    project, root: destination,
    files: Object.entries(files).map(([relative, content]) => ({ path: relative, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex'), protected: !units.some(unit => unit.modulePath === relative) })),
    units,
    integration: { testPath: 'test/cli.test.cjs', testArgs: ['--test', '--test-reporter=tap', 'test/cli.test.cjs'], baselineFailures: [...definition.integrationFailures] },
    testArgs, suiteCommand: 'node ' + testArgs.join(' '),
  };
}

module.exports = { PROJECT_IDS, generateFixture };
