'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { main } = require('./magi-whoami.js');
const { loadMatrix } = require('./dispatch-matrix.js');

function invoke(argv) {
  let stdout = '', stderr = '';
  const exitCode = main(argv, { stdout: { write(text) { stdout += text; } }, stderr: { write(text) { stderr += text; } } });
  return { exitCode, stdout, stderr };
}

test('the exact runtime arbiter declaration is legal in either argument order', () => {
  const slug = loadMatrix().principles.arbiterModel;
  for (const args of [['--mode', 'cursor-cli', '--slug', slug], ['--slug', slug, '--mode', 'cursor-cli']]) {
    const result = invoke(args);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /^LEGAL\b/);
    assert.match(result.stdout, /declaration only.*not proof of the actual picker/i);
    assert.equal(result.stderr, '');
  }
});

test('forbidden modes and inexact or foreign slugs are illegal', () => {
  const slug = loadMatrix().principles.arbiterModel;
  for (const [mode, declared] of [['cursor', slug], ['claude', slug], ['cursor-cli', slug.toUpperCase()],
    ['cursor-cli', `cursor-${slug}-high-fast`], ['cursor-cli', 'gpt-5.6-sol']]) {
    const result = invoke(['--mode', mode, '--slug', declared]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^ILLEGAL\b/);
  }
});

test('the declared slug follows runtime policy rather than a built-in model list', t => {
  t.mock.method(require('./dispatch-matrix.js'), 'loadMatrix', () => ({ principles: { arbiterModel: 'fixture-arbiter' } }));
  assert.equal(invoke(['--mode', 'cursor-cli', '--slug', 'fixture-arbiter']).exitCode, 0);
  assert.equal(invoke(['--mode', 'cursor-cli', '--slug', 'grok-4.6']).exitCode, 1);
});

test('missing duplicate unknown and malformed arguments fail with exit two', () => {
  const legal = ['--mode', 'cursor-cli', '--slug', loadMatrix().principles.arbiterModel];
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
