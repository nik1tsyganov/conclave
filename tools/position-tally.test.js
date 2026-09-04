'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');

const {
  tally,
  TallyError,
  PASSAGE_THRESHOLD,
  QUORUM_FLOOR,
  DEGRADED_VENDOR,
  VERDICT,
} = require('./position-tally.js');

const node = process.execPath;
const cli = path.join(__dirname, 'position-tally.js');

function ballot(elector, position, role) {
  const row = { elector, position };
  if (role !== undefined) row.role = role;
  return row;
}

function trio(a, b, c) {
  return [
    ballot('anthropic', a),
    ballot('openai', b),
    ballot('google', c),
  ];
}

function runCli(args, extra = {}) {
  return spawnSync(node, [cli, ...args], { encoding: 'utf8', ...extra });
}

describe('position-tally rules', () => {
  it('uses a 2-of-3 passage threshold and a matching quorum floor', () => {
    assert.strictEqual(PASSAGE_THRESHOLD, 2);
    assert.strictEqual(QUORUM_FLOOR, 2);
    assert.strictEqual(DEGRADED_VENDOR, 'anthropic');
  });

  it('passes a full trio of APPROVE', () => {
    const result = tally(trio('APPROVE', 'APPROVE', 'APPROVE'));
    assert.strictEqual(result.verdict, VERDICT.PASSAGE);
    assert.strictEqual(result.approveCount, 3);
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.degraded, false);
    assert.strictEqual(result.reason, null);
    assert.deepStrictEqual(result.eligibleElectors, ['anthropic', 'openai', 'google']);
  });

  it('passes on exactly two APPROVE among three electors', () => {
    const result = tally(trio('APPROVE', 'APPROVE', 'REJECT'));
    assert.strictEqual(result.verdict, VERDICT.PASSAGE);
    assert.strictEqual(result.approveCount, 2);
    assert.strictEqual(result.rejectCount, 1);
  });

  it('counts ABSTAIN away from passage so two APPROVE still pass', () => {
    const result = tally(trio('APPROVE', 'APPROVE', 'ABSTAIN'));
    assert.strictEqual(result.verdict, VERDICT.PASSAGE);
    assert.strictEqual(result.approveCount, 2);
    assert.strictEqual(result.abstainCount, 1);
  });

  it('deadlocks when ABSTAIN leaves fewer than two APPROVE', () => {
    const result = tally(trio('APPROVE', 'ABSTAIN', 'ABSTAIN'));
    assert.strictEqual(result.verdict, VERDICT.DEADLOCK);
    assert.strictEqual(result.approveCount, 1);
    assert.strictEqual(result.abstainCount, 2);
    assert.strictEqual(result.passed, false);
  });

  it('deadlocks a mixed trio below the threshold', () => {
    const result = tally(trio('APPROVE', 'REJECT', 'ABSTAIN'));
    assert.strictEqual(result.verdict, VERDICT.DEADLOCK);
    assert.strictEqual(result.approveCount, 1);
    assert.strictEqual(result.rejectCount, 1);
    assert.strictEqual(result.abstainCount, 1);
  });

  it('deadlocks three REJECT and three ABSTAIN — no panel REJECTED verdict', () => {
    assert.strictEqual(tally(trio('REJECT', 'REJECT', 'REJECT')).verdict, VERDICT.DEADLOCK);
    assert.strictEqual(tally(trio('ABSTAIN', 'ABSTAIN', 'ABSTAIN')).verdict, VERDICT.DEADLOCK);
  });

  it('never treats ABSTAIN as APPROVE even when every elector votes', () => {
    const result = tally(trio('ABSTAIN', 'APPROVE', 'ABSTAIN'));
    assert.strictEqual(result.approveCount, 1);
    assert.strictEqual(result.abstainCount, 2);
    assert.ok(!result.counted.some((row) => row.position === 'ABSTAIN' && row.position === 'APPROVE'));
  });

  it('passes when a third elector is missing but two APPROVE are present', () => {
    const result = tally([ballot('anthropic', 'APPROVE'), ballot('openai', 'APPROVE')]);
    assert.strictEqual(result.verdict, VERDICT.PASSAGE);
    assert.deepStrictEqual(result.missingElectors, ['google']);
  });

  it('emits NOT_PANEL + degraded quorumFloor when only one eligible elector voted', () => {
    const result = tally([ballot('anthropic', 'APPROVE')]);
    assert.strictEqual(result.verdict, VERDICT.NOT_PANEL);
    assert.strictEqual(result.degraded, true);
    assert.strictEqual(result.reason, 'quorumFloor');
    assert.strictEqual(result.approveCount, 1);
    assert.strictEqual(result.passed, false);
    assert.deepStrictEqual(result.missingElectors, ['openai', 'google']);
  });

  it('emits NOT_PANEL on an empty panel — fail closed, not a false DEADLOCK', () => {
    const result = tally({ ballots: [] });
    assert.strictEqual(result.verdict, VERDICT.NOT_PANEL);
    assert.strictEqual(result.degraded, true);
    assert.strictEqual(result.reason, 'quorumFloor');
    assert.strictEqual(result.approveCount, 0);
    assert.deepStrictEqual(result.missingElectors, ['anthropic', 'openai', 'google']);
  });

  it('still deadlocks once quorum is met and APPROVE stays below two', () => {
    const result = tally([ballot('anthropic', 'APPROVE'), ballot('openai', 'ABSTAIN')]);
    assert.strictEqual(result.verdict, VERDICT.DEADLOCK);
    assert.strictEqual(result.degraded, false);
    assert.strictEqual(result.approveCount, 1);
    assert.strictEqual(result.abstainCount, 1);
  });
});

describe('position-tally degraded duo (cursor-cli Claude fail)', () => {
  it('passes when both remaining electors APPROVE and ignores a Claude APPROVE', () => {
    const result = tally({
      ballots: trio('APPROVE', 'APPROVE', 'APPROVE'),
      degraded: true,
    });
    assert.strictEqual(result.verdict, VERDICT.PASSAGE);
    assert.strictEqual(result.approveCount, 2);
    assert.strictEqual(result.degraded, true);
    assert.strictEqual(result.reason, 'degraded-claude');
    assert.deepStrictEqual(result.eligibleElectors, ['openai', 'google']);
    assert.deepStrictEqual(result.ineligible, [{ elector: 'anthropic', reason: 'degraded-claude' }]);
    assert.strictEqual(result.ignored.length, 1);
    assert.strictEqual(result.ignored[0].elector, 'anthropic');
  });

  it('deadlocks a degraded duo when one remaining elector ABSTAINS', () => {
    const result = tally({
      ballots: [ballot('openai', 'APPROVE'), ballot('google', 'ABSTAIN')],
      degraded: true,
    });
    assert.strictEqual(result.verdict, VERDICT.DEADLOCK);
    assert.strictEqual(result.approveCount, 1);
    assert.strictEqual(result.abstainCount, 1);
  });

  it('deadlocks a degraded duo on APPROVE + REJECT', () => {
    const result = tally({
      ballots: [ballot('openai', 'APPROVE'), ballot('google', 'REJECT')],
      degradedVendor: 'anthropic',
    });
    assert.strictEqual(result.verdict, VERDICT.DEADLOCK);
    assert.strictEqual(result.rejectCount, 1);
  });

  it('refuses to treat idle Casper as the degraded path', () => {
    assert.throws(
      () => tally({ ballots: trio('APPROVE', 'APPROVE', 'APPROVE'), degradedVendor: 'google' }),
      (error) => {
        assert.ok(error instanceof TallyError);
        assert.match(error.message, /idle Casper/);
        return true;
      },
    );
  });

  it('fail-closes a degraded duo when a remaining seat is down (NOT_PANEL)', () => {
    const result = tally({
      ballots: [ballot('openai', 'APPROVE')],
      degraded: true,
    });
    assert.strictEqual(result.verdict, VERDICT.NOT_PANEL);
    assert.strictEqual(result.degraded, true);
    assert.strictEqual(result.reason, 'quorumFloor');
    assert.strictEqual(result.approveCount, 1);
    assert.deepStrictEqual(result.missingElectors, ['google']);
  });
});

describe('position-tally vote roles and recusal', () => {
  it('records implementer/reviewer/verifier gate roles without changing passage', () => {
    const result = tally([
      ballot('anthropic', 'APPROVE', 'implementer'),
      ballot('openai', 'APPROVE', 'reviewer'),
      ballot('google', 'ABSTAIN', 'verifier'),
    ]);
    assert.strictEqual(result.verdict, VERDICT.PASSAGE);
    assert.deepStrictEqual(
      result.counted.map((row) => row.role),
      ['implementer', 'reviewer', 'verifier'],
    );
  });

  it('accepts telemetry role vocabulary on a POSITION ballot', () => {
    const result = tally([
      { vendor: 'anthropic', role: 'implement', position: 'APPROVE' },
      { vendor: 'openai', role: 'review', position: 'APPROVE' },
      { vendor: 'google', role: 'verify', position: 'REJECT' },
    ]);
    assert.strictEqual(result.verdict, VERDICT.PASSAGE);
    assert.strictEqual(result.approveCount, 2);
  });

  it('recuses the author vendor from passage (protocol 6)', () => {
    const result = tally({
      ballots: trio('APPROVE', 'APPROVE', 'APPROVE'),
      authorVendor: 'anthropic',
    });
    assert.strictEqual(result.verdict, VERDICT.PASSAGE);
    assert.strictEqual(result.approveCount, 2);
    assert.deepStrictEqual(result.ineligible, [{ elector: 'anthropic', reason: 'author-recusal' }]);
  });

  it('deadlocks when author recusal leaves only one APPROVE', () => {
    const result = tally({
      ballots: trio('APPROVE', 'APPROVE', 'ABSTAIN'),
      authorVendor: 'openai',
    });
    assert.strictEqual(result.verdict, VERDICT.DEADLOCK);
    assert.strictEqual(result.approveCount, 1);
  });

  it('fail-closes duo-degraded plus recusal when counted eligible ballots drop below quorum', () => {
    const result = tally({
      ballots: trio('APPROVE', 'APPROVE', 'APPROVE'),
      degraded: true,
      authorVendor: 'openai',
    });
    assert.strictEqual(result.verdict, VERDICT.NOT_PANEL);
    assert.strictEqual(result.degraded, true);
    assert.strictEqual(result.reason, 'quorumFloor');
    assert.strictEqual(result.approveCount, 1);
    assert.deepStrictEqual(result.eligibleElectors, ['google']);
    assert.deepStrictEqual(
      result.ineligible.map((row) => row.reason).sort(),
      ['author-recusal', 'degraded-claude'],
    );
  });

  it('rejects an arbiter ballot as an illegal elector', () => {
    assert.throws(
      () => tally([ballot('arbiter', 'APPROVE'), ballot('openai', 'APPROVE')]),
      /illegal elector: arbiter/,
    );
    assert.throws(
      () => tally([ballot('camerlengo-8', 'APPROVE')]),
      /illegal elector: camerlengo-8/,
    );
  });

  it('rejects a duplicate elector, unknown position, and unknown role', () => {
    assert.throws(
      () => tally([ballot('openai', 'APPROVE'), ballot('openai', 'REJECT')]),
      /duplicate elector: openai/,
    );
    assert.throws(() => tally([ballot('openai', 'YES')]), /invalid position/);
    assert.throws(() => tally([ballot('openai', 'APPROVE', 'scribe')]), /invalid role/);
  });
});

describe('position-tally CLI', () => {
  it('exits 0 and prints PASSAGE for a passing trio', () => {
    const r = runCli(['--ballots', JSON.stringify(trio('APPROVE', 'APPROVE', 'REJECT')), '--json']);
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.verdict, 'PASSAGE');
    assert.strictEqual(out.approveCount, 2);
  });

  it('exits 1 for DEADLOCK', () => {
    const r = runCli(['--ballots', JSON.stringify(trio('APPROVE', 'ABSTAIN', 'REJECT'))]);
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /verdict: DEADLOCK/);
  });

  it('exits 1 fail-closed for NOT_PANEL quorum floor', () => {
    const r = runCli(['--ballots', JSON.stringify([ballot('openai', 'APPROVE')]), '--json']);
    assert.strictEqual(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.verdict, 'NOT_PANEL');
    assert.strictEqual(out.degraded, true);
    assert.strictEqual(out.reason, 'quorumFloor');
  });

  it('exits 2 on illegal arbiter input', () => {
    const r = runCli(['--ballots', JSON.stringify([ballot('grok', 'APPROVE')])]);
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /illegal elector: grok/);
  });

  it('reads JSONL from --file and honors --degraded', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'position-tally-'));
    const file = path.join(dir, 'ballots.jsonl');
    writeFileSync(
      file,
      [
        JSON.stringify(ballot('anthropic', 'APPROVE')),
        JSON.stringify(ballot('openai', 'APPROVE')),
        JSON.stringify(ballot('google', 'APPROVE')),
      ].join('\n'),
    );
    try {
      const r = runCli(['--file', file, '--degraded', '--json']);
      assert.strictEqual(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.strictEqual(out.verdict, 'PASSAGE');
      assert.strictEqual(out.approveCount, 2);
      assert.strictEqual(out.ineligible[0].reason, 'degraded-claude');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints usage on --help', () => {
    const r = runCli(['--help']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /--ballots/);
    assert.match(r.stdout, /ABSTAIN never toward passage/);
  });
});
