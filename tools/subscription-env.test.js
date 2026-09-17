// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with section 7 terms; see LICENSE.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { subscriptionEnv, buildLaunch } = require('./cli-adapters.js');

const prohibited = [
  'OPENAI_API_KEY', 'AZURE_OPENAI_API_KEY', 'OPENAI_BASE_URL',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI',
  'GOOGLE_APPLICATION_CREDENTIALS', 'CLAUDECODE',
  'SYNARA_ANTIGRAVITY_EVENTS', 'SYNARA_ANTIGRAVITY_HOOK_DECISION',
];
const mixed = key => key.toLowerCase().replace(/(^|_)([a-z])/g, (_, prefix, letter) => prefix + letter.toUpperCase());
const allAliases = Object.fromEntries(prohibited.flatMap(key => [key, key.toLowerCase(), mixed(key)]).map(key => [key, 'synthetic']));
const allowed = {
  Path: 'synthetic-path', HOME: '/synthetic-home',
  CODEX_HOME: '/synthetic-codex', CLAUDE_CODE_OAUTH_TOKEN: 'synthetic-oauth', MAGI_DEV_ROOT: '/opt/magi/src',
  OPENAI_API_KEY_BACKUP: 'synthetic-near-match', MY_GOOGLE_API_KEY: 'synthetic-near-match',
};

for (const key of prohibited) {
  for (const [label, alias] of [['exact', key], ['lowercase', key.toLowerCase()], ['mixed case', mixed(key)]]) {
    test(`subscription environment removes ${label} ${key}`, () => {
      const source = Object.freeze({ ...allowed, [alias]: 'synthetic' });
      assert.deepEqual(subscriptionEnv(source), allowed);
      assert.equal(source[alias], 'synthetic');
    });
  }
}

test('duplicate-case credential aliases are all removed while allowed variables retain spelling and values', () => {
  assert.deepEqual(subscriptionEnv({ ...allAliases, ...allowed }), allowed);
});

test('prototype properties do not become child environment variables', () => {
  const source = Object.assign(Object.create({ ...allAliases, PROTOTYPE_ONLY: 'synthetic' }), allowed);
  assert.deepEqual(subscriptionEnv(source), allowed);
});

test('default source sanitizes inherited process variables without changing the parent environment', () => {
  const script = `const assert = require('node:assert/strict');
    const { subscriptionEnv } = require(${JSON.stringify(path.join(__dirname, 'cli-adapters.js'))});
    assert.equal(process.env.openai_api_key, 'synthetic');
    const result = subscriptionEnv();
    const blocked = ${JSON.stringify(prohibited)};
    assert.equal(Object.keys(result).some(key => blocked.includes(key.toUpperCase())), false);
    assert.equal(result.CLAUDE_CODE_OAUTH_TOKEN, 'synthetic-oauth');
    assert.equal(process.env.openai_api_key, 'synthetic');`;
  const result = spawnSync(process.execPath, ['-e', script], {
    env: {
      SystemRoot: process.env.SystemRoot,
      ...Object.fromEntries(prohibited.map(key => [key.toLowerCase(), 'synthetic'])),
      CLAUDE_CODE_OAUTH_TOKEN: 'synthetic-oauth',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

for (const vendor of ['openai', 'anthropic', 'google']) {
  for (const role of ['implement', 'verify']) {
    test(`${vendor} ${role} launch receives sanitized subscription environment`, t => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magi-env-'));
      t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
      const briefPath = path.join(directory, 'brief.md');
      fs.writeFileSync(briefPath, 'SYNTHETIC ENV TEST\nNo native call.\n');
      const source = {
        ...allAliases, ...allowed,
        MAGI_CODEX_BIN: path.join(directory, 'codex'),
        MAGI_CLAUDE_BIN: path.join(directory, 'claude'),
        MAGI_AGY_BIN: path.join(directory, 'agy'),
      };
      const launch = buildLaunch({
        vendor, role, cwd: '/opt/magi/src/synthetic-work', briefPath,
        seatContractPath: path.join(directory, 'SEAT-CONTRACT.md'),
        skillRoot: path.join(directory, 'skills'),
        capturePath: path.join(directory, 'capture.txt'),
        env: source, mustExistBinary: false,
      });
      assert.equal(Object.keys(launch.env).some(key => prohibited.includes(key.toUpperCase())), false);
      if (vendor === 'google') assert.equal(launch.args.filter(arg => arg === '--disable-slash-commands').length, 1);
      for (const [key, value] of Object.entries(allowed)) assert.equal(launch.env[key], value);
      assert.deepEqual(source, {
        ...allAliases, ...allowed,
        MAGI_CODEX_BIN: path.join(directory, 'codex'),
        MAGI_CLAUDE_BIN: path.join(directory, 'claude'),
        MAGI_AGY_BIN: path.join(directory, 'agy'),
      });
    });
  }
}
