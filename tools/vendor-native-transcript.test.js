'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { temporary } = require('./test-fixtures.js');
const { codexSessionTranscript, googleSessionTranscript } = require('./vendor-native.js');
const id = '10000000-0000-4000-8000-000000000001';
function fixture(t) {
  const root = temporary(t), codexHome = path.join(root, 'native-home');
  const directory = path.join(codexHome, 'sessions', '2026', '09', '07');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `rollout-2026-09-07T12-00-00-${id}.jsonl`);
  const cwd = '/opt/magi/src/product';
  const text = `${JSON.stringify({ type: 'session_meta', payload: { id, cwd } })}\n${JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', thread_id: id } })}\n`;
  fs.writeFileSync(file, text);
  return { file, directory, codexHome, cwd, text };
}
test('native transcript selection binds exact session and workspace without choosing newest', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'rollout-newest-unrelated.jsonl'), 'not our session');
  assert.deepEqual(codexSessionTranscript(id, f), { path: f.file, text: f.text });
  assert.throws(() => codexSessionTranscript(id, { ...f, cwd: '/opt/magi/src/other' }), /does not match/);
});
test('native transcript rejects missing, duplicate and malformed captures', t => {
  const f = fixture(t);
  assert.throws(() => codexSessionTranscript('20000000-0000-4000-8000-000000000002', f), /missing or ambiguous/);
  const duplicate = path.join(f.directory, `rollout-duplicate-${id}.jsonl`);
  fs.copyFileSync(f.file, duplicate);
  assert.throws(() => codexSessionTranscript(id, f), /missing or ambiguous/);
  fs.unlinkSync(duplicate);
  fs.appendFileSync(f.file, '{partial');
  assert.throws(() => codexSessionTranscript(id, f), /incomplete or malformed/);
});
test('native transcript rejects an unrelated session inside a matching filename', t => {
  const f = fixture(t);
  fs.writeFileSync(f.file, f.text.replaceAll(id, '20000000-0000-4000-8000-000000000002'));
  assert.throws(() => codexSessionTranscript(id, f), /does not match/);
  assert.throws(() => codexSessionTranscript('../escape', f), /invalid/);
});
test('Codex collector rejects a hardlinked transcript and a junction sessions root', t => {
  const f = fixture(t);
  const linked = path.join(f.codexHome, 'external.jsonl');
  fs.linkSync(f.file, linked);
  assert.throws(() => codexSessionTranscript(id, f), /plain|single-link/);
  fs.unlinkSync(linked);
  const root = path.join(f.codexHome, 'sessions');
  const moved = path.join(f.codexHome, 'external-sessions');
  fs.renameSync(root, moved);
  fs.symlinkSync(moved, root, 'junction');
  assert.throws(() => codexSessionTranscript(id, f), /plain/);
});
function googleFixture(t) {
  const home = temporary(t);
  const briefPath = path.join(home, 'dispatch', 'BRIEF.md');
  const seatContractPath = path.join(home, 'dispatch', 'SEAT-CONTRACT.md');
  const directory = path.join(home, '.gemini', 'antigravity-cli', 'brain', id, '.system_generated', 'logs');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'transcript_full.jsonl');
  const row = { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', content: `Read ${briefPath} in full. Read ${seatContractPath} in full.` };
  const text = JSON.stringify(row) + '\n';
  fs.writeFileSync(file, text);
  fs.writeFileSync(path.join(directory, 'transcript.jsonl'), 'compact and truncated');
  return { home, briefPath, seatContractPath, file, text, row };
}
test('Google collector selects only exact native full conversation transcript and bound prompt', t => {
  const f = googleFixture(t);
  assert.deepEqual(googleSessionTranscript(id, f), { path: f.file, text: f.text });
  assert.throws(() => googleSessionTranscript(id, { ...f, briefPath: path.join(f.home, 'other.md') }), /does not bind/);
  assert.throws(() => googleSessionTranscript('../escape', f), /invalid/);
});
test('Google collector rejects malformed, compact, duplicate-prompt and truncated evidence', t => {
  const f = googleFixture(t);
  fs.writeFileSync(f.file, '{partial');
  assert.throws(() => googleSessionTranscript(id, f), /incomplete or malformed/);
  fs.writeFileSync(f.file, f.text + f.text);
  assert.throws(() => googleSessionTranscript(id, f), /does not bind/);
  fs.writeFileSync(f.file, JSON.stringify({ ...f.row, truncated_fields: ['content'] }) + '\n');
  assert.throws(() => googleSessionTranscript(id, f), /truncation/);
  fs.unlinkSync(f.file);
  assert.throws(() => googleSessionTranscript(id, f), /ENOENT/);
});
test('Google collector rejects hardlinks and junctions above the conversation folder', t => {
  const f = googleFixture(t);
  const linked = path.join(f.home, 'external.jsonl');
  fs.linkSync(f.file, linked);
  assert.throws(() => googleSessionTranscript(id, f), /plain|single-link/);
  fs.unlinkSync(linked);
  const root = path.join(f.home, '.gemini');
  const moved = path.join(f.home, 'external-gemini');
  fs.renameSync(root, moved);
  fs.symlinkSync(moved, root, 'junction');
  assert.throws(() => googleSessionTranscript(id, f), /plain/);
});
