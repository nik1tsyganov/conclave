// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with section 7 terms; see LICENSE.
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { main, HOST_MODES } = require('./magi-whoami.js');
const { loadMatrix } = require('./dispatch-matrix.js');

function invoke(argv) {
  let stdout = '', stderr = '';
  const exitCode = main(argv, { stdout: { write(text) { stdout += text; } }, stderr: { write(text) { stderr += text; } } });
  return { exitCode, stdout, stderr };
}

test('every CLI host mode is legal with any host slug, and names the runtime arbiter engine', () => {
  const { arbiterVendor, arbiterModel } = loadMatrix().principles;
  assert.equal(arbiterVendor, 'jev');
  assert.deepEqual(HOST_MODES, ['cursor-cli', 'synara', 'claude-code', 'droppy']);
  for (const mode of HOST_MODES) for (const slug of ['claude-fable-5-1', 'cursor-grok-4.6-high-fast', 'gpt-5.6-sol']) {
    for (const args of [['--mode', mode, '--slug', slug], ['--slug', slug, '--mode', mode]]) {
      const result = invoke(args);
      assert.equal(result.exitCode, 0, JSON.stringify(args));
      assert.match(result.stdout, new RegExp(`^LEGAL: ${mode} host=${slug} arbiter=jev/${arbiterModel}\\.`));
      assert.match(result.stdout, /declaration only.*not proof of the actual picker/i);
      assert.equal(result.stderr, '');
    }
  }
});

test('modes outside the CLI host list are illegal', () => {
  for (const mode of ['cursor', 'claude', 'banana', 'CURSOR-CLI']) {
    const result = invoke(['--mode', mode, '--slug', 'any-host']);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^ILLEGAL\b/);
  }
});

test('the arbiter engine comes from runtime policy rather than a built-in list', t => {
  t.mock.method(require('./dispatch-matrix.js'), 'loadMatrix', () => ({ principles: { arbiterVendor: 'jev', arbiterModel: 'fixture-engine' } }));
  assert.match(invoke(['--mode', 'cursor-cli', '--slug', 'h']).stdout, /arbiter=jev\/fixture-engine/);
  t.mock.method(require('./dispatch-matrix.js'), 'loadMatrix', () => ({ principles: {} }));
  assert.equal(invoke(['--mode', 'cursor-cli', '--slug', 'h']).exitCode, 2);
});

test('missing duplicate unknown and malformed arguments fail with exit two', () => {
  const legal = ['--mode', 'cursor-cli', '--slug', 'host-slug'];
  for (const args of [[], ['--mode'], ['--slug', 'grok-4.6'], ['--mode', 'cursor-cli'],
    ['--mode', '--slug', 'grok-4.6'], ['--mode', '', '--slug', 'grok-4.6'],
    ['--mode', 'cursor-cli', '--mode', 'cursor-cli'], ['--slug', 'grok-4.6', '--slug', 'grok-4.6'],
    ['--mode', 'cursor-cli', '--slug', ' grok-4.6'], ['--mode', 'cursor-cli', '--slug', 'grok-4.6\n'],
    [...legal, '--mode', 'cursor-cli'], [...legal, '--slug', 'grok-4.6'], [...legal, '--unknown', 'x'],
    [...legal, 'extra'], ['--mode=cursor-cli', '--slug', 'grok-4.6'], [...legal, '--help']]) {
    const result = invoke(args);
    assert.equal(result.exitCode, 2, JSON.stringify(args));
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /ARGUMENT_ERROR/);
  }
});
