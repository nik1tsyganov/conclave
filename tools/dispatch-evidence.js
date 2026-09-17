// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const ATTESTATION_PROTOCOL = 'conclave-claude-post-run-attestation-v1';
const AWAITING_ATTESTATION = 'AWAITING_ATTESTATION';

function evidenceError(message, code = 'EVIDENCE_FAIL') { return Object.assign(new Error(message), { code }); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function hashFile(file) { return hash(fs.readFileSync(file)); }
function runtimeManifest() {
  return fs.readdirSync(__dirname).filter(name => name.endsWith('.js') && !name.endsWith('.test.js')).sort().map(name => ({ path: name, sha256: hashFile(path.join(__dirname, name)) }));
}
// Same rule as runtime-paths.canonicalPlainPath: a POSIX symlink that is a direct
// child of the filesystem root (macOS /tmp, /var) is platform layout, so it is
// resolved first and the rule re-asserted on the realpath. Deeper links and hard
// links stay refused.
function assertPlainPath(file) {
  const target = path.resolve(file);
  let current = target;
  while (true) {
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() && path.dirname(current) === path.parse(current).root) return assertPlainPath(path.resolve(fs.realpathSync.native(current), path.relative(current, target)));
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) throw evidenceError(`evidence path must not contain symlinks, junctions or hard links: ${current}`, 'SCOPE_FAIL');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function writeJson(file, value) {
  assertPlainPath(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  assertPlainPath(file);
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
}
function inside(file, root) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function snapshotWorkspace(root) {
  root = fs.realpathSync(root);
  const files = {};
  function walk(directory, prefix = '') {
    for (const name of fs.readdirSync(directory).sort()) {
      if (!prefix && name === '.git') continue;
      const full = path.join(directory, name);
      const relative = `${prefix}${name}`;
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw evidenceError(`workspace links are not supported by scope audit: ${relative}`, 'SCOPE_FAIL');
      if (stat.isDirectory()) walk(full, `${relative}/`);
      else if (stat.isFile()) {
        if (stat.nlink > 1) throw evidenceError(`workspace hard links are not supported by scope audit: ${relative}`, 'SCOPE_FAIL');
        files[relative] = { sha256: hashFile(full), executable: Boolean(stat.mode & 0o111) };
      }
      else throw evidenceError(`unsupported workspace entry: ${relative}`, 'SCOPE_FAIL');
    }
  }
  walk(root);
  let git = null;
  if (fs.existsSync(path.join(root, '.git'))) {
    const opts = { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } };
    const readGit = (args) => execFileSync('git', ['-C', root, ...args], opts);
    const head = spawnSync('git', ['-C', root, 'rev-parse', '--verify', '--quiet', 'HEAD'], opts);
    if (head.error || ![0, 1].includes(head.status)) throw evidenceError('cannot read workspace git HEAD');
    git = { head: head.status === 0 ? head.stdout.trim() : null, staged: readGit(['diff', '--cached', '--raw']), status: readGit(['status', '--porcelain=v1', '-z']), diffStat: readGit(['diff', '--stat']) };
    const gitDir = readGit(['rev-parse', '--absolute-git-dir']).trim();
    const commonDir = path.resolve(root, readGit(['rev-parse', '--git-common-dir']).trim());
    const controlFiles = [...new Set([path.join(commonDir, 'config'), path.join(gitDir, 'config.worktree'), path.join(gitDir, 'HEAD'), ...(fs.lstatSync(path.join(root, '.git')).isFile() ? [path.join(root, '.git')] : [])])];
    git.controls = {};
    for (const file of controlFiles) git.controls[file] = fs.existsSync(file) ? hashFile(file) : null;
  }
  return { root, files, git, coverage: 'workspace files, Git HEAD/index/config/worktree pointer; vendor home is not isolated' };
}
function compareWorkspace(before, after, scope = []) {
  const names = [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].sort();
  const changedFiles = names.filter((name) => JSON.stringify(before.files[name]) !== JSON.stringify(after.files[name])).map((name) => ({
    path: name, before: before.files[name] || null, after: after.files[name] || null,
    allowed: scope.some((allowed) => name === allowed || name.startsWith(`${allowed}/`)),
  }));
  const gitChanged = before.git?.head !== after.git?.head || before.git?.staged !== after.git?.staged || JSON.stringify(before.git?.controls) !== JSON.stringify(after.git?.controls);
  return { ok: !gitChanged && changedFiles.every((file) => file.allowed), changedFiles, gitChanged, coverage: after.coverage };
}
function transactionKey(entry) { return hash(JSON.stringify([entry.dispatchId, entry.unitId, entry.role])); }
function reserveTransaction(binding, evidenceDir, attestationProtocol) {
  const root = path.join(path.dirname(binding.planPath), '.conclave-dispatches');
  assertPlainPath(root);
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, `${transactionKey(binding.entry)}.json`);
  const requestHash = hash(JSON.stringify({ planHash: binding.planHash, entry: binding.entry }));
  const state = { schemaVersion: 1, status: 'RUNNING', requestHash, planHash: binding.planHash, planId: binding.plan.planId, entry: binding.entry, evidenceDir, startedAt: new Date().toISOString(), ...(attestationProtocol ? { attestationProtocol } : {}) };
  try { fs.writeFileSync(file, `${JSON.stringify(state)}\n`, { encoding: 'utf8', flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (previous.requestHash !== requestHash) throw evidenceError('logical dispatch already belongs to a different validated plan', 'DUPLICATE_DISPATCH');
    if (previous.status === AWAITING_ATTESTATION) return { file, state: previous, pending: true, replayed: true };
    if (previous.status === 'RETRYABLE') {
      // A classified launch failure (R22 retry clause, 2026-09-16) re-runs under the same id.
      const attempts = Array.isArray(previous.attempts) ? previous.attempts : [];
      if (attempts.length >= require('./launch-retry.js').MAX_ATTEMPTS) throw evidenceError('launch retries exhausted; use a new dispatch ID and validate its plan', 'DUPLICATE_DISPATCH');
      const retried = { ...state, attempts };
      fs.writeFileSync(file, `${JSON.stringify(retried)}\n`, 'utf8');
      return { file, state: retried, replayed: false, retrying: true };
    }
    if (previous.status !== 'PASS') throw evidenceError(`logical dispatch is ${previous.status}; use a new dispatch ID and validate its plan`, 'DUPLICATE_DISPATCH');
    verifyCommittedRow(previous.telemetry);
    return { file, state: previous, replayed: true };
  }
  return { file, state, replayed: false };
}
function appendUniqueRow(file, row) {
  assertPlainPath(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  assertPlainPath(file);
  const rows = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map(JSON.parse) : [];
  if (row.dispatchId && row.unitId) {
    const prior = rows.find((item) => item.dispatchId === row.dispatchId && item.unitId === row.unitId && item.role === row.role);
    if (prior) {
      if (JSON.stringify(prior) !== JSON.stringify(row)) throw evidenceError('conflicting duplicate telemetry row', 'DUPLICATE_DISPATCH');
      return false;
    }
  }
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
  return true;
}
function verifyCommittedRow(row, { checkLogs = true } = {}) {
  if (row.schemaVersion !== 2 || row.status !== 'PASS' || !row.transactionPath) throw evidenceError('activation requires a committed dispatch transaction');
  const state = JSON.parse(fs.readFileSync(row.transactionPath, 'utf8'));
  if (state.status !== 'PASS' || JSON.stringify(state.telemetry) !== JSON.stringify(row)) throw evidenceError('telemetry and committed transaction disagree');
  verifyArtifacts(state);
  for (const log of checkLogs ? state.logs || [] : []) {
    const matches = fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse).filter((item) => item.dispatchId === row.dispatchId && item.unitId === row.unitId && item.role === row.role);
    if (matches.length !== 1 || JSON.stringify(matches[0]) !== JSON.stringify(row)) throw evidenceError('dispatch log and committed transaction disagree');
  }
  return state;
}

// Runtime policy files (dispatch-matrix.json, seat-profiles.json) are bound to the
// SEAL at dispatch time (dispatch-run refuses a launch whose installed policy differs
// from the sealed policy). On replay they are checked against the sealed hashes, so a
// later policy change never invalidates history; live drift is reported, not fatal.
function policyPins(state) {
  try {
    const runRoot = path.dirname(path.dirname(state.evidenceDir));
    const seal = JSON.parse(fs.readFileSync(path.join(runRoot, 'plan-seal.json'), 'utf8'));
    const paths = require('./runtime-paths.js').resolveRuntimePaths();
    return new Map([[path.resolve(paths.matrixPath), seal.matrixSha256], [path.resolve(paths.profilesPath || path.join(path.dirname(paths.matrixPath), 'seat-profiles.json')), seal.profilesSha256]]);
  } catch { return new Map(); }
}
function verifyArtifacts(state, { pins = policyPins(state) } = {}) {
  if (!Array.isArray(state.artifacts) || state.artifacts.length < 5) throw evidenceError('committed transaction has incomplete evidence');
  const drift = [];
  for (const item of state.artifacts) {
    assertPlainPath(item.path);
    const pinned = pins.get(path.resolve(item.path));
    if (pinned !== undefined) {
      if (item.sha256 !== pinned) throw evidenceError(`committed policy differs from the sealed policy: ${item.path}`);
      if (fs.existsSync(item.path) && hashFile(item.path) !== item.sha256) drift.push(item.path);
      continue;
    }
    if (hashFile(item.path) !== item.sha256) throw evidenceError(`committed evidence changed: ${item.path}`);
  }
  return { policyDrift: drift };
}

module.exports = { ATTESTATION_PROTOCOL, AWAITING_ATTESTATION, appendUniqueRow, policyPins, assertPlainPath, compareWorkspace, hash, hashFile, inside, reserveTransaction, runtimeManifest, snapshotWorkspace, transactionKey, verifyArtifacts, verifyCommittedRow, writeJson };
