'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const {
  DEFAULT_MAGI_BUS_ROOT,
  HOST_MODES,
  getRepoRoot,
  getMagiBusRoot,
  isUnderRoot,
  assertInJail,
  assertHostMode,
} = require('./magi-bus-path.js');

const ROOT = path.resolve(__dirname, '..');

function withBusRoot(busRoot, fn) {
  const previous = process.env.MAGI_BUS_ROOT;
  process.env.MAGI_BUS_ROOT = busRoot;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.MAGI_BUS_ROOT;
    else process.env.MAGI_BUS_ROOT = previous;
  }
}

describe('magi-bus-path', () => {
  it('default MAGI_BUS_ROOT matches cli-claude.js', () => {
    assert.strictEqual(DEFAULT_MAGI_BUS_ROOT, path.join(tmpdir(), 'magi-bus'));
    assert.strictEqual(getRepoRoot(), ROOT);
    assert.deepStrictEqual(HOST_MODES, ['cursor', 'cursor-cli', 'synara', 'claude-code']);
  });

  it('allows repo paths and MAGI_BUS_ROOT, refuses prefix traps and outsiders', () => {
    const bus = mkdtempSync(path.join(tmpdir(), 'magi-bus-jail-'));
    const outsider = mkdtempSync(path.join(tmpdir(), 'magi-bus-outside-'));
    try {
      withBusRoot(bus, () => {
        assert.strictEqual(getMagiBusRoot(), bus);
        assert.strictEqual(assertInJail(path.join(ROOT, 'tools', 'cli-pointer.js')), path.join(ROOT, 'tools', 'cli-pointer.js'));
        assert.strictEqual(assertInJail(path.join(bus, 'brief.md')), path.join(bus, 'brief.md'));
        assert.strictEqual(isUnderRoot(path.join(bus, 'nested', 'a.md'), bus), true);
        assert.strictEqual(isUnderRoot(`${bus}-evil${path.sep}brief.md`, bus), false);
        assert.throws(() => assertInJail(`${bus}-evil${path.sep}brief.md`), /outside the pointer zones/);
        assert.throws(() => assertInJail(path.join(outsider, 'brief.md')), /outside the pointer zones/);
        assert.throws(() => assertInJail(path.join(bus, '..', path.basename(outsider), 'brief.md')), /outside the pointer zones/);
      });
    } finally {
      rmSync(bus, { recursive: true, force: true });
      rmSync(outsider, { recursive: true, force: true });
    }
  });

  it('accepts both hostMode values and rejects others', () => {
    assert.strictEqual(assertHostMode('cursor'), 'cursor');
    assert.strictEqual(assertHostMode('cursor-cli'), 'cursor-cli');
    assert.strictEqual(assertHostMode('synara'), 'synara');
    assert.strictEqual(assertHostMode('claude-code'), 'claude-code');
    assert.throws(() => assertHostMode('banana'), /hostMode must be/);
    assert.throws(() => assertHostMode(undefined), /hostMode must be/);
  });
});
