'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { canonicalPlainPath, pathsOverlap, DEFAULT_ROOT } = require('./runtime-paths.js');
const { assertPlainPath, inside, snapshotWorkspace, transactionKey } = require('./dispatch-evidence.js');

function fail(message) { throw Object.assign(new Error(`evidenceReadDirs: ${message}`), { code: 'POLICY_FAIL' }); }
function identity(file) { return file; }

// Plan paths can precede their producer. Contents and completion are checked at launch/replay.
function validateEvidenceReadDirs(entry, { plan, runDir, requireExisting = false, forbiddenRoots = [] } = {}) {
  if (entry.evidenceReadDirs === undefined) return [];
  if (!['verify', 'review'].includes(entry.role) || !Array.isArray(entry.evidenceReadDirs)) fail('only checking entries may declare an array');
  const dirs = entry.evidenceReadDirs.map(file => {
    if (typeof file !== 'string' || !path.isAbsolute(file) || file.split(/[\\/]/).some(part => part === '.' || part === '..')) fail('absolute paths without traversal are required');
    const canonical = canonicalPlainPath(file); // 8.3/case aliases rewrite here; junctions still fail
    assertPlainPath(canonical);
    if (requireExisting && (!fs.existsSync(canonical) || !fs.statSync(canonical).isDirectory())) fail('directory must exist before launch');
    if (fs.existsSync(canonical) && !fs.statSync(canonical).isDirectory()) fail('read target must be a directory');
    return canonical;
  });
  const forbidden = [DEFAULT_ROOT, ...forbiddenRoots, ...(plan?.dispatches || [entry]).flatMap(row => [row.cwd, row.brief]).filter(Boolean),
    ...['.codex', '.claude', '.gemini', '.cursor', '.agents'].map(name => path.join(os.homedir(), name))].map(canonicalPlainPath);
  for (let index = 0; index < dirs.length; index++) {
    const dir = dirs[index];
    if (forbidden.some(root => pathsOverlap(dir, root)) || dirs.slice(0, index).some(root => pathsOverlap(dir, root))) fail('duplicate, overlapping or protected directory');
    if (!runDir) continue; // Structural adapter/matrix validation; sealing supplies the attempt boundary.
    const run = canonicalPlainPath(runDir);
    const external = canonicalPlainPath(path.join(path.dirname(run), 'evidence'));
    const prior = (plan?.dispatches || []).find(row => row.dispatchId !== entry.dispatchId && row.unitId === entry.unitId &&
      (row.role === 'implement' || (entry.role === 'review' && row.role === 'verify')) &&
      identity(canonicalPlainPath(path.join(run, 'out', row.dispatchId))) === identity(dir));
    if (!prior && !(inside(dir, external) && !pathsOverlap(dir, run))) fail('must be a dedicated attempt/evidence directory or an exact same-unit prerequisite output');
    if (prior && requireExisting) {
      const file = path.join(run, '.magi-dispatches', `${transactionKey(prior)}.json`);
      assertPlainPath(file);
      const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
      if (state?.status !== 'PASS' || !Number.isFinite(Date.parse(state.completedAt)) || identity(canonicalPlainPath(state.evidenceDir)) !== identity(dir)) fail('prerequisite evidence is not complete');
    }
  }
  return dirs;
}

function snapshotEvidenceReads(dirs) {
  return dirs.map(dir => {
    canonicalPlainPath(dir); assertPlainPath(dir);
    if (fs.existsSync(path.join(dir, '.git'))) fail('evidence must not be a repository');
    return snapshotWorkspace(dir);
  });
}

function validateEvidenceReadLaunch(launch, entry, dirs, context) {
  if (!entry.evidenceReadDirs?.length) return;
  if (!isDeepStrictEqual(launch.evidenceReadDirs, dirs)) fail('launch directories differ from sealed entry');
  if (entry.vendor === 'openai') return; // The exact read-only/scratch profile is validated by native proof.
  const expected = [...new Set([context.cwd, path.dirname(context.briefPath), context.skillRoot, path.dirname(context.seatContractPath), ...dirs])];
  const granted = [];
  if (launch.args.some(arg => typeof arg === 'string' && /^--(?:add-dir|sandbox|permission-mode|tools|allowedTools)=/.test(arg))) fail('alternate native grant syntax is forbidden');
  for (let i = 0; i < launch.args.length; i++) if (launch.args[i] === '--add-dir') granted.push(launch.args[++i]);
  if (!isDeepStrictEqual(granted.map(canonicalPlainPath).map(identity).sort(), expected.map(canonicalPlainPath).map(identity).sort())) fail('native directory grants differ from bound paths');
  if (entry.vendor === 'google' && (launch.args.filter(arg => arg === '--sandbox').length !== 1 || launch.args.some(arg => ['--dangerously-skip-permissions', '--yolo'].includes(arg)))) fail('Google checking access must remain sandboxed');
  if (entry.vendor === 'anthropic' && (launch.args.includes('--dangerously-skip-permissions') || ['--permission-mode', '--tools', '--allowedTools'].some((flag, index) => launch.args.filter(arg => arg === flag).length !== 1 || launch.args[launch.args.indexOf(flag) + 1] !== ['dontAsk', 'Read,Glob,Grep', 'Read,Glob,Grep'][index]))) fail('Claude checking access must remain read-only');
}

module.exports = { validateEvidenceReadDirs, snapshotEvidenceReads, validateEvidenceReadLaunch };
