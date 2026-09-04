#!/usr/bin/env node
'use strict';

/**
 * Magi CLI dry-run smoke gate.
 *
 * Proves pointer delivery for all three vendor launchers without spending a
 * live seat: calls cli-launch.js main() with --dry-run for openai, google,
 * and anthropic (in-process require, no vendor child process), then fails
 * closed if the brief is missing the Magi CLI RULES markers, if any printed
 * plan leaks the brief body into an argument or a stdin file, if the OpenAI
 * plan is not pointer delivery or pipes the brief path itself, if the
 * google -p value is the brief body, or if the google plan is missing
 * `--add-dir ...\.claude\skills` (DevOps/harness: agy must see MAGI skills).
 *
 * Exit 0 smoke ok; 1 leak, plan defect, or missing RULES; 2 ARGUMENT_ERROR.
 */

const fs = require('node:fs');
const path = require('node:path');

const { main: launchMain } = require('./cli-launch.js');
const { checkBriefText, formatMissing } = require('./cli-brief-rules-check.js');

const VENDORS = ['openai', 'google', 'anthropic'];

function usage() {
  return [
    'Usage: node tools/cli-smoke.js --brief <file> --cwd <dir>',
    '',
    'Dry-runs the openai, google, and anthropic launch plans through',
    'cli-launch.js (no vendor process spawns) and fails closed if the brief',
    'is missing the Magi CLI RULES markers, if any brief-body leaks into',
    'arguments or stdin files, or if the google plan is missing',
    '--add-dir ...\\.claude\\skills.',
  ].join('\n');
}

function argumentError(message) {
  const error = new Error(message);
  error.code = 'ARGUMENT_ERROR';
  return error;
}

function smokeError(message) {
  const error = new Error(message);
  error.code = 'SMOKE_FAIL';
  return error;
}

function parseArgs(argv) {
  const options = { help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') {
      options.help = true;
    } else if (flag === '--brief' || flag === '--cwd') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw argumentError(`${flag} requires a value`);
      }
      options[flag.slice(2)] = value;
      index += 1;
    } else {
      throw argumentError(`Unknown option: ${flag}`);
    }
  }
  return options;
}

function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function assertNoBodyLeak(vendor, plan, body) {
  if (body.length === 0) return;
  for (const arg of plan.args || []) {
    if (String(arg).includes(body)) {
      throw smokeError(`${vendor} plan leaks the brief body into an argument`);
    }
  }
  if (plan.stdinFile && fs.readFileSync(plan.stdinFile, 'utf8').includes(body)) {
    throw smokeError(`${vendor} stdin file ${plan.stdinFile} leaks the brief body`);
  }
}

function assertOpenaiPlan(plan, briefPath) {
  if (plan.delivery !== 'pointer') {
    throw smokeError(
      `openai plan delivery is ${JSON.stringify(plan.delivery)}, expected "pointer"`,
    );
  }
  if (!plan.stdinFile || samePath(plan.stdinFile, briefPath)) {
    throw smokeError('openai plan pipes the brief path itself instead of a pointer file');
  }
}

const GOOGLE_SKILLS_ADD_DIR_NEEDLE = '.claude\\skills';

function googlePlanHasSkillsAddDir(args) {
  const list = args || [];
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] !== '--add-dir') continue;
    const dir = String(list[index + 1] || '').replace(/\//g, '\\').toLowerCase();
    if (dir.includes(GOOGLE_SKILLS_ADD_DIR_NEEDLE.toLowerCase())) return true;
  }
  return false;
}

function assertGooglePlan(plan, body) {
  const args = plan.args || [];
  const flagIndex = args.indexOf('-p');
  const value = flagIndex === -1 ? null : args[flagIndex + 1];
  if (body.length > 0 && value === body) {
    throw smokeError('google -p value is the brief body, expected a pointer');
  }
  // DevOps/harness: live agy launches MUST --add-dir ...\.claude\skills.
  // Smoke asserts that grant on the google dry-run plan (no vendor spend).
  if (!googlePlanHasSkillsAddDir(args)) {
    throw smokeError(
      `google plan missing --add-dir ...\\${GOOGLE_SKILLS_ADD_DIR_NEEDLE} (agy must see MAGI skills)`,
    );
  }
}

async function dryRunVendor(vendor, briefPath, cwd, dependencies = {}) {
  let stdout = '';
  let stderr = '';
  const code = await launchMain(
    [
      '--vendor', vendor,
      '--brief', briefPath,
      '--cwd', cwd,
      '--capture', `${briefPath}.smoke-capture.txt`,
      '--dry-run',
    ],
    {
      stdout: { write(chunk) { stdout += chunk; } },
      stderr: { write(chunk) { stderr += chunk; } },
    },
    dependencies,
  );
  return { code, stdout, stderr };
}

async function main(argv = process.argv.slice(2), io = process, dependencies = {}) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      io.stdout.write(`${usage()}\n`);
      return 0;
    }
    if (typeof options.brief !== 'string' || options.brief.length === 0) {
      throw argumentError('--brief is required');
    }
    if (typeof options.cwd !== 'string' || options.cwd.length === 0) {
      throw argumentError('--cwd is required');
    }
    const briefPath = path.resolve(options.brief);
    let body;
    try {
      body = fs.readFileSync(briefPath, 'utf8');
    } catch {
      throw argumentError(`--brief file does not exist: ${briefPath}`);
    }
    if (body.length > 0) {
      const rules = checkBriefText(body);
      if (!rules.ok) {
        throw smokeError(formatMissing(rules.missing));
      }
    }

    const vendors = [];
    for (const vendor of VENDORS) {
      const run = await dryRunVendor(vendor, briefPath, options.cwd, dependencies);
      if (run.code !== 0) {
        io.stderr.write(run.stderr || `${vendor} dry-run exited ${run.code}\n`);
        return run.code;
      }
      let plan;
      try {
        plan = JSON.parse(run.stdout);
      } catch {
        throw smokeError(`${vendor} dry-run printed no JSON plan`);
      }
      assertNoBodyLeak(vendor, plan, body);
      if (vendor === 'openai') assertOpenaiPlan(plan, briefPath);
      if (vendor === 'google') assertGooglePlan(plan, body);
      vendors.push(vendor);
    }

    io.stdout.write(`${JSON.stringify({ ok: true, vendors })}\n`);
    return 0;
  } catch (error) {
    const code = error.code || 'SMOKE_FAIL';
    io.stderr.write(`${code}: ${error.message}\n`);
    return code === 'ARGUMENT_ERROR' ? 2 : 1;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = {
  GOOGLE_SKILLS_ADD_DIR_NEEDLE,
  VENDORS,
  assertGooglePlan,
  assertNoBodyLeak,
  assertOpenaiPlan,
  googlePlanHasSkillsAddDir,
  main,
  parseArgs,
};
