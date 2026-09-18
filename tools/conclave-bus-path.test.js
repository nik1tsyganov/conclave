// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const {
  DEFAULT_CONCLAVE_BUS_ROOT,
  HOST_MODES,
  getRepoRoot,
  getConclaveBusRoot,
  isUnderRoot,
  assertInJail,
  assertHostMode,
} = require('./conclave-bus-path.js');
const { HOST_MODES: SCHEMA_HOST_MODES } = require('./dispatch-schema.js');

const ROOT = path.resolve(__dirname, '..');

function withBusRoot(busRoot, fn) {
  const previous = process.env.CONCLAVE_BUS_ROOT;
  process.env.CONCLAVE_BUS_ROOT = busRoot;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.CONCLAVE_BUS_ROOT;
    else process.env.CONCLAVE_BUS_ROOT = previous;
  }
}

describe('conclave-bus-path', () => {
  it('default CONCLAVE_BUS_ROOT matches cli-claude.js', () => {
    assert.strictEqual(DEFAULT_CONCLAVE_BUS_ROOT, path.join(tmpdir(), 'conclave-bus'));
    assert.strictEqual(getRepoRoot(), ROOT);
  });

  // Until 2026-09-18 this module froze its own four-name copy of the host modes, so
  // assertHostMode threw for vscode and droppy while dispatch-schema accepted both. Identity,
  // not equality: a copy that happens to match today is the thing that drifted last time.
  it('shares one host-mode list with the dispatch schema', () => {
    assert.strictEqual(HOST_MODES, SCHEMA_HOST_MODES, 'HOST_MODES must be dispatch-schema.js\'s own array, not a copy');
    for (const mode of ['vscode', 'droppy']) {
      assert.ok(HOST_MODES.includes(mode), `${mode} is a host in dispatch-schema.js, so it is a host here`);
    }
    const src = readFileSync(path.join(__dirname, 'conclave-bus-path.js'), 'utf8');
    assert.doesNotMatch(src, /const HOST_MODES = Object\.freeze/, 'redeclaring HOST_MODES here is how the two lists drifted apart');
    assert.match(src, /require\('\.\/dispatch-schema\.js'\)/);
  });

  it('allows repo paths and CONCLAVE_BUS_ROOT, refuses prefix traps and outsiders', () => {
    const bus = mkdtempSync(path.join(tmpdir(), 'conclave-bus-jail-'));
    const outsider = mkdtempSync(path.join(tmpdir(), 'conclave-bus-outside-'));
    try {
      withBusRoot(bus, () => {
        assert.strictEqual(getConclaveBusRoot(), bus);
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

  // Walks the list rather than quoting it, so adding a host cannot make this fail for
  // saying the right thing -- the same fix commit afc28d0 made to the dispatch-matrix test.
  it('accepts every host mode the dispatch schema defines and rejects others', () => {
    for (const mode of HOST_MODES) assert.strictEqual(assertHostMode(mode), mode);
    assert.throws(() => assertHostMode('banana'), /hostMode must be/);
    assert.throws(() => assertHostMode(undefined), /hostMode must be/);
    // The message names the legal hosts by reading the list, never in frozen prose.
    assert.throws(() => assertHostMode('banana'), new RegExp(HOST_MODES.join(', ')));
  });
});
