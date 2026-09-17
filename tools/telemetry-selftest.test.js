// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

/**
 * Round-trip selftest for the lead-written telemetry contract
 * (.cursor/skills/magi/references/cursor-host.md, "Lead-written telemetry").
 *
 * The sibling tools land in separate seat dispatches:
 *   tools/telemetry-append.js  (Codex seat)
 *   tools/telemetry-stats.js   (Gemini seat)
 * When a sibling is not on disk yet, its test SKIPS (suite still exits 0) so
 * this file can merge first; the lead re-runs the suite after the merge, when
 * both skips must disappear.
 *
 * Contract exercised against the real tools when present:
 *   node tools/telemetry-append.js --row '<json>' --log <tempfile>
 *   node tools/telemetry-stats.js --log <tempfile> --json
 * - on success telemetry-append.js confirms on stdout with
 *   `appended <vendor>/<role> <logpath>`
 * - a row missing hostMode is rejected (nonzero exit, log unchanged)
 * - stats never reports an unmeasured token column as 0 — a zero that was
 *   never measured forges a free dispatch and hides an UNMEASURED channel
 * - this test never writes the real telemetry/dispatches.jsonl
 */

const { spawnSync } = require('node:child_process');
const it = require('node:test').it;
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const node = process.execPath;
const APPEND = path.join(__dirname, 'telemetry-append.js');
const STATS = path.join(__dirname, 'telemetry-stats.js');
const REAL_LOG = path.join(__dirname, '..', 'telemetry', 'dispatches.jsonl');

const ROWS = [
  { vendor: 'openai', role: 'implement', hostMode: 'cursor-cli', routedBy: 'arbiter' },
  { vendor: 'google', role: 'implement', hostMode: 'cursor-cli', routedBy: 'arbiter' },
  { vendor: 'anthropic', role: 'implement', hostMode: 'cursor-cli', routedBy: 'arbiter' },
];

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-telemetry-selftest-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function realLogSize() {
  return fs.existsSync(REAL_LOG) ? fs.statSync(REAL_LOG).size : null;
}

function assertRealLogUntouched(sizeBefore) {
  const sizeAfter = realLogSize();
  if (sizeBefore === null && sizeAfter !== null) {
    // Restore the pre-test state, but only remove content this test itself
    // produced; anything else stays on disk as forensic evidence.
    const lines = fs.readFileSync(REAL_LOG, 'utf8').split(/\r?\n/).filter((line) => line.trim() !== '');
    const ownRows = new Set(ROWS.map((row) => JSON.stringify(row)));
    const onlyOwnRows = lines.every((line) => ownRows.has(line));
    if (onlyOwnRows) fs.unlinkSync(REAL_LOG);
    assert.fail(`the selftest created the real telemetry/dispatches.jsonl (${onlyOwnRows ? 'removed again' : 'left in place: it holds rows this test did not write'})`);
  }
  assert.strictEqual(sizeAfter, sizeBefore, 'the real telemetry/dispatches.jsonl changed during the selftest');
}

function logLines(logPath) {
  return fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter((line) => line.trim() !== '');
}

// Builds the three-row temp log: through the real append tool when it exists
// (the round trip), otherwise by hand against the documented row contract.
function buildTempLog(dir) {
  const logPath = path.join(dir, 'dispatches.jsonl');
  if (fs.existsSync(APPEND)) {
    for (const row of ROWS) {
      const r = spawnSync(node, [APPEND, '--row', JSON.stringify(row), '--log', logPath], { cwd: dir, encoding: 'utf8' });
      assert.strictEqual(r.status, 0, `append rejected a valid row: ${r.stderr || r.stdout}`);
    }
  } else {
    fs.writeFileSync(logPath, ROWS.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  }
  return logPath;
}

// With zero measured rows a token column must never render as a bare numeric
// zero: mean 0 is the empty-set-mean bug, and sum 0 without an explicit
// measured-count of 0 is indistinguishable from a measured zero spend.
function assertNoZeroConflation(section, name) {
  if (section === null || section === undefined) return; // column omitted entirely: fine
  assert.ok(typeof section === 'object' && !Array.isArray(section),
    `${name} must be an object when present, got ${Array.isArray(section) ? 'array' : typeof section}`);
  assert.notStrictEqual(section.mean, 0,
    `${name}.mean is 0 for a log with no measured tokens — unmeasured rendered as zero`);
  if (section.sum === 0) {
    const countKeys = ['count', 'measured', 'measuredRows'];
    assert.ok(countKeys.some((key) => section[key] === 0),
      `${name}.sum is 0 with no measured-count field — unmeasured rendered as zero spend`);
  }
}

if (fs.existsSync(APPEND)) {
  it('telemetry-append: three rows land in a temp log; a row missing hostMode is rejected', () => {
    withTempDir((dir) => {
      const sizeBefore = realLogSize();
      const logPath = path.join(dir, 'dispatches.jsonl');
      // The real-log guard must run even when an assertion above it throws
      // (e.g. --log silently ignored), without masking that first failure.
      let guardError = null;
      try {
        for (const row of ROWS) {
          const r = spawnSync(node, [APPEND, '--row', JSON.stringify(row), '--log', logPath], { cwd: dir, encoding: 'utf8' });
          assert.strictEqual(r.status, 0, `append rejected a valid row: ${r.stderr || r.stdout}`);
          assert.match(r.stdout, /^appended /, 'append must confirm the row on stdout');
        }
        const written = logLines(logPath);
        assert.strictEqual(written.length, 3, 'the temp log must hold exactly 3 rows');
        assert.deepStrictEqual(written.map((line) => JSON.parse(line)), ROWS,
          'the appended rows must round-trip to the exact input rows');

        const noHostMode = { vendor: 'openai', role: 'implement', routedBy: 'arbiter' };
        const rejected = spawnSync(node, [APPEND, '--row', JSON.stringify(noHostMode), '--log', logPath], { cwd: dir, encoding: 'utf8' });
        assert.notStrictEqual(rejected.status, 0, 'a row missing hostMode must be rejected');
        assert.deepStrictEqual(logLines(logPath).map((line) => JSON.parse(line)), ROWS,
          'a rejected row must not land in, replace, or corrupt the log');
      } finally {
        try {
          assertRealLogUntouched(sizeBefore);
        } catch (error) {
          guardError = error;
        }
      }
      if (guardError) throw guardError;
    });
  });
} else {
  it('skip: telemetry-append.js sibling not yet landed (Codex seat writes it; lead re-runs after merge)', (t) => {
    t.skip('tools/telemetry-append.js not on disk');
  });
}

if (fs.existsSync(STATS)) {
  it('telemetry-stats: reads the appended log; missing tokens are never reported as 0', () => {
    withTempDir((dir) => {
      const logPath = buildTempLog(dir);
      const r = spawnSync(node, [STATS, '--log', logPath, '--json'], { cwd: dir, encoding: 'utf8' });
      assert.strictEqual(r.status, 0, `stats failed on a valid log: ${r.stderr || r.stdout}`);

      let stats;
      try {
        stats = JSON.parse(r.stdout);
      } catch (error) {
        assert.fail(`stats --json did not print a JSON object: ${error.message}\n${r.stdout}`);
      }
      assert.strictEqual(stats.captureHealth.rowCount, 3, 'stats must count the 3 appended rows');

      const tokens = stats.tokens || {};
      assertNoZeroConflation(tokens.vendorSideTokens, 'tokens.vendorSideTokens');
      assertNoZeroConflation(tokens.totalTokens, 'tokens.totalTokens');
    });
  });
} else {
  it('skip: telemetry-stats.js sibling not yet landed (Gemini seat writes it; lead re-runs after merge)', (t) => {
    t.skip('tools/telemetry-stats.js not on disk');
  });
}
