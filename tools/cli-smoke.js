#!/usr/bin/env node
'use strict';

/**
 * Offline pointer-delivery diagnostic for the production transport adapters.
 * Builds plans only; never invokes a vendor or validates/activates a run.
 * One staged seat supplies the test inputs. Plans for all three transports do
 * not establish that those vendors are authorized by a sealed production plan.
 */

const fs = require('node:fs');
const path = require('node:path');
const { buildLaunch } = require('./cli-adapters.js');
const { checkBriefText, formatMissing, verifyStagedSeat } = require('./cli-brief-rules-check.js');

const VENDORS = ['openai', 'google', 'anthropic'];

function usage() {
  return [
    'Usage: node tools/cli-smoke.js --brief <file> --cwd <dir> [--skill-root <staged-skills-dir>] [--seat-contract <SEAT-CONTRACT.md>]',
    '',
    'Builds offline pointer-delivery plans for openai, google, and anthropic.',
    'Defaults to the adjacent SEAT-CONTRACT.md, seat-profile.json, and skills directory.',
    'Checks staged skill files and pointer delivery, including the exact Google --add-dir grant.',
    'No vendor process runs. This diagnostic cannot activate production work.',
    'Production launches use dispatch-run.js --plan <sealed-plan.json> --run-dir <dir> --dispatch-id <id>.',
  ].join('\n');
}

function argumentError(message) { return Object.assign(new Error(message), { code: 'ARGUMENT_ERROR' }); }
function smokeError(message) { return Object.assign(new Error(message), { code: 'SMOKE_FAIL' }); }

function parseArgs(argv) {
  const options = { help: false };
  const values = { '--brief': 'brief', '--cwd': 'cwd', '--skill-root': 'skillRoot', '--seat-contract': 'seatContractPath' };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') options.help = true;
    else if (values[flag]) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw argumentError(`${flag} requires a value`);
      options[values[flag]] = value;
    } else throw argumentError(`Unknown option: ${flag}`);
  }
  return options;
}

function samePath(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function assertNoBodyLeak(vendor, plan, body) {
  if (body.length === 0) return;
  for (const arg of plan.args || []) {
    if (String(arg).includes(body)) throw smokeError(`${vendor} plan leaks the brief body into an argument`);
  }
  if (plan.stdinFile && fs.readFileSync(plan.stdinFile, 'utf8').includes(body)) {
    throw smokeError(`${vendor} stdin file ${plan.stdinFile} leaks the brief body`);
  }
}

function assertOpenaiPlan(plan, briefPath) {
  const delivery = plan.delivery || (
    plan.pointerFile && plan.stdinFile && samePath(plan.pointerFile, plan.stdinFile) &&
    plan.args?.at(-1) === '-' ? 'pointer' : null
  );
  if (delivery !== 'pointer') throw smokeError(`openai plan delivery is ${JSON.stringify(delivery)}, expected "pointer"`);
  if (!plan.stdinFile || samePath(plan.stdinFile, briefPath)) {
    throw smokeError('openai plan pipes the brief path itself instead of a pointer file');
  }
}

function googlePlanHasSkillsAddDir(args, skillRoot) {
  if (typeof skillRoot !== 'string' || !skillRoot) return false;
  const list = args || [];
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] === '--add-dir' && typeof list[index + 1] === 'string' && samePath(list[index + 1], skillRoot)) return true;
  }
  return false;
}

function assertGooglePlan(plan, body, skillRoot) {
  const args = plan.args || [];
  const flagIndex = args.indexOf('-p');
  const value = flagIndex === -1 ? null : args[flagIndex + 1];
  if (body.length > 0 && value === body) throw smokeError('google -p value is the brief body, expected a pointer');
  if (typeof value !== 'string' || !value.trim()) throw smokeError('google plan has no -p pointer');
  if (!googlePlanHasSkillsAddDir(args, skillRoot)) {
    throw smokeError(`google plan missing --add-dir for the staged skill root: ${skillRoot || '(missing)'}`);
  }
}

async function main(argv = process.argv.slice(2), io = process) {
  try {
    const options = parseArgs(argv);
    if (options.help) { io.stdout.write(`${usage()}\n`); return 0; }
    if (!options.brief) throw argumentError('--brief is required');
    if (!options.cwd) throw argumentError('--cwd is required');
    const briefPath = path.resolve(options.brief);
    let body;
    try { body = fs.readFileSync(briefPath, 'utf8'); }
    catch { throw argumentError(`--brief file does not exist: ${briefPath}`); }
    if (!body.trim()) throw argumentError(`--brief file is empty: ${briefPath}`);
    const rules = checkBriefText(body);
    if (!rules.ok) throw smokeError(formatMissing(rules.missing));
    const staged = verifyStagedSeat(briefPath, options);

    for (const vendor of VENDORS) {
      // buildLaunch only prepares transport arguments and pointer files.
      // Binary existence and native availability remain outside this diagnostic.
      const plan = buildLaunch({
        vendor, briefPath, cwd: options.cwd, role: staged.seatProfile.role,
        skillRoot: staged.skillRoot, seatContractPath: staged.seatContractPath,
        capturePath: `${briefPath}.smoke-capture.txt`, mustExistBinary: false,
      });
      assertNoBodyLeak(vendor, plan, body);
      if (vendor === 'openai') assertOpenaiPlan(plan, briefPath);
      if (vendor === 'google') assertGooglePlan(plan, body, staged.skillRoot);
    }
    io.stdout.write(`${JSON.stringify({ ok: true, vendors: VENDORS, dryRun: true, diagnostic: 'pointer-delivery-only', activationEligible: false })}\n`);
    return 0;
  } catch (error) {
    const code = error.code || 'SMOKE_FAIL';
    io.stderr.write(`${code}: ${error.message}\n`);
    return code === 'ARGUMENT_ERROR' ? 2 : 1;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });
module.exports = { VENDORS, assertGooglePlan, assertNoBodyLeak, assertOpenaiPlan, googlePlanHasSkillsAddDir, main, parseArgs };
