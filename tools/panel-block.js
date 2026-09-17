#!/usr/bin/env node
// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

// Reading the block a lead ends its reply with.
//
// A lead asks for a panel by closing its reply with one fenced block whose info string is
// `conclave`, holding a JSON array of units. Entries are taken as their closing brace
// arrives, so the first unit can start while the lead is still writing the second; a fence
// quoted inside a brief does not end the block; and a block that cannot be read leaves the
// reply rather than sitting there doing nothing.
//
// Whole-block and streamed reading must agree on the order and the count of what goes out, so
// both end in `finish`, which is where ids are defaulted and made unique. A unit that went out
// early and then vanished from the final reading would have run unrecorded.

const OPENER = /^[ \t]*```[ \t]*(?:conclave|brains)(?:-sent)?[ \t]*\r?\n/im;

/// Where the opening fence is. The line anchor matters: a lead explaining the format to the
/// user mid-sentence ("finish with ```conclave and a JSON array") would otherwise open a block
/// and send a panel out on whatever followed.
function openerMatch(text) {
  const match = OPENER.exec(text);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

/// Every three backticks that open a line from `start` on. A fence with an info string counts:
/// inside a brief that is what a quoted snippet looks like, and the reader needs those to know
/// where not to cut.
function lineStartFences(text, start) {
  const fences = [];
  let at = text.indexOf('```', start);
  while (at !== -1) {
    if (at === 0 || text[at - 1] === '\n') fences.push({ start: at, end: at + 3 });
    at = text.indexOf('```', at + 3);
  }
  return fences;
}

/// Whether the three backticks at `fence` are alone on their line.
function isBareFence(text, fence) {
  let index = fence.end;
  while (index < text.length && (text[index] === ' ' || text[index] === '\t')) index += 1;
  return index === text.length || text[index] === '\n' || text[index] === '\r';
}

function isJSONWhitespace(ch) {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';
}

/// One entry read as a unit. An entry with no brief is not a unit at all and is skipped, by
/// the same rule in both readers, so the two agree on what goes out. Field names are taken
/// loosely: a lead that writes `prompt` for the brief or `paths` for the files has still said
/// what it means, and a unit lost to a synonym costs a whole round.
function unitFromEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const pick = (...names) => {
    for (const name of names) if (typeof entry[name] === 'string') return entry[name].trim();
    return '';
  };
  const brief = pick('brief', 'prompt', 'instructions');
  if (brief.length === 0) return null;
  const task = pick('task', 'title');
  const rawFiles = entry.files || entry.paths || entry.scope || [];
  const files = (Array.isArray(rawFiles) ? rawFiles : [])
    .filter((f) => typeof f === 'string')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  const test = pick('test', 'check', 'command');
  const oneLine = brief.replace(/\s+/g, ' ').trim();
  return {
    id: pick('unit', 'id'),
    task: task.length > 0 ? task : (oneLine.length > 60 ? `${oneLine.slice(0, 59)}…` : oneLine),
    brief,
    files,
    test: test.length > 0 ? test : null,
    class: typeof entry.class === 'string' ? entry.class : (typeof entry.kind === 'string' ? entry.kind : null),
  };
}

/// Ids, last: a unit the lead did not name takes its place in the block, and a name used twice
/// is made unique rather than merged, since two units sharing an id would have their seats and
/// their verdicts run into each other.
function finish(units) {
  const seen = new Set();
  return units.map((unit, index) => {
    let id = unit.id && unit.id.length > 0 ? unit.id : `U${index + 1}`;
    if (seen.has(id)) {
      let round = 2;
      while (seen.has(`${id}-${round}`)) round += 1;
      id = `${id}-${round}`;
    }
    seen.add(id);
    return { ...unit, id };
  });
}

function unitsFromBody(body) {
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  if (Array.isArray(json) && json.length === 0) return [];
  const entries = Array.isArray(json) ? json : (json && typeof json === 'object' ? [json] : []);
  const parsed = entries.map(unitFromEntry).filter(Boolean);
  return parsed.length === 0 ? null : finish(parsed);
}

/// The entries closed so far in a block body, read without waiting for the JSON to be whole.
///
/// The walk tracks strings with their escapes, so a brace or a fence quoted inside a brief is
/// text like any other. Arrays are counted separately from objects: counting only braces, a
/// nested array's closer looked like the block's own and stopped the walk, so `[[], {...}]`
/// read as no units while the whole reader read one.
function streamedFromBody(body) {
  const closed = [];
  let index = 0;
  while (index < body.length && isJSONWhitespace(body[index])) index += 1;
  if (index >= body.length) return { units: [], isComplete: false };

  let isArray;
  if (body[index] === '[') {
    isArray = true;
    index += 1;
  } else if (body[index] === '{') {
    isArray = false;
  } else {
    return { units: [], isComplete: false };
  }

  let depth = 0;
  let arrayDepth = 0;
  let inString = false;
  let escaped = false;
  let entryStart = index;
  let atLineStart = true;
  const done = () => ({ units: finish(closed), isComplete: true });

  for (; index < body.length; index += 1) {
    const ch = body[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) entryStart = index;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const unit = unitFromEntry(JSON.parse(body.slice(entryStart, index + 1)));
          if (unit) closed.push(unit);
        } catch { /* an entry that will not parse is not a unit */ }
        if (!isArray) return done();
      } else if (depth < 0) {
        // A closer with nothing open: the block is broken past here.
        return done();
      }
    } else if (ch === '[') {
      if (depth === 0) arrayDepth += 1;
    } else if (ch === ']' && depth === 0) {
      if (arrayDepth > 0) arrayDepth -= 1;
      else return done();
    } else if (ch === '`' && depth === 0 && atLineStart) {
      // A fence opening a line outside any entry is the block's closer.
      return done();
    }
    atLineStart = ch === '\n';
  }
  return { units: finish(closed), isComplete: false };
}

/// The block's units and where it ends, from one walk, so what is parsed and what is cut out
/// of the reply can never be two different blocks.
///
/// Closers are tried in order of how likely each is to be the real one. The first bare fence
/// that opens a line comes first: a brief cannot hold a raw newline, so a fence at the start
/// of a line after the opener is the block's own closer in every well-formed reply, and taking
/// the last fence instead used to swallow a code block the lead wrote for the user underneath.
/// The remaining fences, last to first, come next, for a reply malformed enough to have put a
/// real newline inside a brief. The end of the text is last, for a block whose closer never came.
function read(text) {
  const opener = openerMatch(text);
  if (!opener) return null;
  const bodyStart = opener.end;
  const fences = lineStartFences(text, bodyStart);
  const candidates = [];
  const bare = fences.find((fence) => isBareFence(text, fence));
  if (bare) candidates.push(bare);
  candidates.push(...[...fences].reverse());
  candidates.push(null);

  const seen = new Set();
  for (const candidate of candidates) {
    const end = candidate ? candidate.start : text.length;
    if (seen.has(end)) continue;
    seen.add(end);
    const parsed = unitsFromBody(text.slice(bodyStart, end));
    if (parsed !== null) return { units: parsed, end: candidate ? candidate.end : text.length };
  }
  // Nothing parsed as whole JSON. Before calling the block unreadable, read it the way the
  // streamed reader does. The two must never disagree about what went out, and the streamed
  // reader has already sent these: a stray byte after the array must not turn units that are
  // already building into a block nobody can read.
  const salvaged = streamedFromBody(text.slice(bodyStart)).units;
  if (salvaged.length === 0) return null;
  return { units: salvaged, end: fences.length > 0 ? fences[fences.length - 1].end : text.length };
}

/// The units a finished reply asks for, or null when there is no readable block. An empty
/// array is a block that asks for nothing and comes back as an empty list, not as null.
function units(text) {
  const result = read(text);
  return result ? result.units : null;
}

/// The block of a reply as far as it has streamed: null until its opening fence is there.
function streamedUnits(text) {
  const opener = openerMatch(text);
  if (!opener) return null;
  return streamedFromBody(text.slice(opener.end));
}

function hasBlock(text) {
  return openerMatch(text) !== null;
}

/// The reply with its block taken out: what the lead actually said to the user.
function without(text) {
  const opener = openerMatch(text);
  if (!opener) return text.trim();
  const result = read(text);
  const end = result ? result.end : text.length;
  return `${text.slice(0, opener.start)}${text.slice(end)}`.trim();
}

module.exports = { hasBlock, read, streamedUnits, unitFromEntry, units, without };
