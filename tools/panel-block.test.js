// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

// The Swift suite's block cases, run against the port. The one that matters most is the last:
// the whole reader and the streamed reader must agree at the end of every reply, because a
// unit that went out early and then vanished from the final reading would run unrecorded.

const test = require('node:test');
const assert = require('node:assert/strict');
const block = require('./panel-block.js');

const FENCE = '```';
const reply = (body, info = 'conclave') => `I split this up.\n\n${FENCE}${info}\n${body}\n${FENCE}`;

test('a block is found only when its fence opens a line', () => {
  assert.equal(block.hasBlock(reply('[]')), true);
  // A lead explaining the format mid-sentence must not open a block.
  assert.equal(block.hasBlock('finish with ```conclave and a JSON array of units'), false);
  assert.equal(block.hasBlock('no block here at all'), false);
  assert.equal(block.hasBlock(reply('[]', 'CONCLAVE')), true, 'the info string is read in any case');
});

test('the prose survives and the block goes', () => {
  const text = reply('[{"unit":"U1","brief":"1. Add it."}]');
  assert.equal(block.without(text), 'I split this up.');
  assert.equal(block.without('nothing to cut'), 'nothing to cut');
  // A reply that is only a block leaves nothing behind, which is why a caller puts its own
  // line there rather than showing an empty bubble.
  assert.equal(block.without(`${FENCE}conclave\n[{"unit":"U1","brief":"b"}]\n${FENCE}`), '');
});

test('an empty block asks for nothing; an unreadable one is a different answer', () => {
  assert.deepEqual(block.units(reply('[]')), [], 'a lead saying it did the work itself');
  assert.equal(block.units(reply('unit one: add the flag')), null, 'not JSON at all');
  assert.equal(block.units('no block'), null);
});

test('an entry with no brief is not a unit', () => {
  assert.equal(block.units(reply('[{"unit":"U1","task":"t"}]')), null, 'nothing to build');
  assert.equal(block.units(reply('[{"unit":"U1","task":"t"},{"unit":"U2","brief":"b"}]')).length, 1);
});

test('field names are taken loosely, because a unit lost to a synonym costs a round', () => {
  const [unit] = block.units(reply('[{"id":"U9","title":"Read it","prompt":"1. Read it.","paths":["a.py"],"check":"pytest","kind":"bulk-mechanical"}]'));
  assert.equal(unit.id, 'U9');
  assert.equal(unit.task, 'Read it');
  assert.equal(unit.brief, '1. Read it.');
  assert.deepEqual(unit.files, ['a.py']);
  assert.equal(unit.test, 'pytest');
  assert.equal(unit.class, 'bulk-mechanical');
});

test('a unit with no task borrows its brief, shortened', () => {
  const [short] = block.units(reply('[{"unit":"U1","brief":"1. Add it."}]'));
  assert.equal(short.task, '1. Add it.');
  const long = 'x'.repeat(200);
  const [cut] = block.units(reply(`[{"unit":"U1","brief":"${long}"}]`));
  assert.ok(cut.task.length <= 60, 'a task is a line, not a brief');
});

test('ids are defaulted by place and made unique, never merged', () => {
  const byPlace = block.units(reply('[{"brief":"a"},{"brief":"b"}]'));
  assert.deepEqual(byPlace.map((u) => u.id), ['U1', 'U2']);
  // Two units under one id would have their seats and their verdicts run into each other.
  const clashing = block.units(reply('[{"unit":"X","brief":"a"},{"unit":"X","brief":"b"},{"unit":"X","brief":"c"}]'));
  assert.deepEqual(clashing.map((u) => u.id), ['X', 'X-2', 'X-3']);
});

test('a fence quoted inside a brief does not end the block', () => {
  const body = '[{"unit":"U1","brief":"Write ```swift and then close it"},{"unit":"U2","brief":"second"}]';
  assert.equal(block.units(reply(body)).length, 2);
});

test('a code block the lead wrote for the user underneath is not swallowed', () => {
  const text = `Here.\n\n${FENCE}conclave\n[{"unit":"U1","brief":"b"}]\n${FENCE}\n\nAnd for you:\n\n${FENCE}swift\nlet x = 1\n${FENCE}`;
  assert.equal(block.units(text).length, 1);
  assert.match(block.without(text), /And for you/, 'the code block stays in the reply');
  assert.match(block.without(text), /let x = 1/);
});

test('a nested array does not stop the walk', () => {
  // Counting only braces, `[[], {...}]` read as no units while the whole reader read one.
  const streamed = block.streamedUnits(`${FENCE}conclave\n[[], {"unit":"U1","brief":"b"}]`);
  assert.equal(streamed.units.length, 1);
});

test('the streamed reader never sends out more, or fewer, than the whole reading holds', () => {
  const replies = [
    reply('[{"unit":"A1","brief":"one"},{"unit":"A2","brief":"two"}]'),
    reply('[]'),
    `${FENCE}conclave\n[{"unit":"U1","brief":"only a block"}]\n${FENCE}`,
    reply('[{"unit":"U1","brief":"Write ```swift inside"},{"unit":"U2","brief":"second"}]'),
  ];
  for (const text of replies) {
    let highest = 0;
    for (let length = 1; length <= text.length; length += 1) {
      const streamed = block.streamedUnits(text.slice(0, length));
      highest = Math.max(highest, streamed ? streamed.units.length : 0);
    }
    const whole = block.units(text);
    assert.equal(highest, whole === null ? highest : whole.length, `agreement on: ${text.slice(0, 40)}`);
  }
});

test('entries are taken as they close, before the block is whole', () => {
  const partial = `${FENCE}conclave\n[{"unit":"U1","brief":"one"},{"unit":"U2","bri`;
  const streamed = block.streamedUnits(partial);
  assert.equal(streamed.units.length, 1, 'the first is building while the second is still being written');
  assert.equal(streamed.isComplete, false);
  assert.equal(block.streamedUnits('no opener yet'), null, 'nothing until the fence arrives');
});
