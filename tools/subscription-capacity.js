'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { assertPlainPath, hashFile } = require('./dispatch-evidence');
const { parseJsonBytes } = require('./json-file');
const safeId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
function required(condition, message) { if (!condition) throw new Error(message); }

// Receipt schema: {schemaVersion:1,observations:[{id,bucketId,subjects:[{vendor,
// model,effort}],legacyBucketIds:[],observedAt,expiresAt,remainingPercent,
// included:true,paidUsageAuthorized:false,source:{kind,evidencePath,evidenceSha256}}]}.
// kind is vendor-native or owner-report; model reachability is not capacity.
function validateCapacity(receipt, legacy, pair, now = Date.now()) {
  required(receipt?.schemaVersion === 1 && Array.isArray(receipt.observations), 'Invalid capacity receipt');
  required(Array.isArray(legacy?.buckets), 'Legacy capacity ledger is missing buckets');
  required(legacy.buckets.every(row => typeof row?.bucketId === 'string' && ['unknown', 'available', 'exhausted'].includes(row.status)) && new Set(legacy.buckets.map(row => row.bucketId)).size === legacy.buckets.length, 'Legacy capacity buckets must be unique and valid');
  const matches = receipt.observations.filter(row => row?.subjects?.some(item => item.vendor === pair.vendor && item.model === pair.model && item.effort === pair.effort));
  required(matches.length === 1, 'Require exactly one capacity observation for the exact subject pair');
  const row = matches[0]; const observed = Date.parse(row.observedAt); const expiry = Date.parse(row.expiresAt);
  required(row.subjects.every(item => item?.vendor === pair.vendor && typeof item.model === 'string' && typeof item.effort === 'string'), 'Shared capacity subjects must name the same vendor');
  required(safeId(row.id) && typeof row.bucketId === 'string' && row.bucketId.length > 0, 'Capacity observation identity is missing');
  required(Number.isFinite(observed) && Number.isFinite(expiry) && observed <= now && expiry > now && expiry > observed && expiry - observed <= 1800000, 'Capacity observation is future, expired, or exceeds 30 minutes');
  required(row.included === true && row.paidUsageAuthorized === false && typeof row.remainingPercent === 'number' && Number.isFinite(row.remainingPercent) && row.remainingPercent > 0 && row.remainingPercent <= 100, 'Included positive capacity is not established');
  required(['vendor-native', 'owner-report'].includes(row.source?.kind) && path.isAbsolute(row.source?.evidencePath || '') && /^[a-f0-9]{64}$/.test(row.source?.evidenceSha256 || ''), 'Capacity needs admitted source evidence');
  assertPlainPath(row.source.evidencePath); required(hashFile(row.source.evidencePath) === row.source.evidenceSha256, 'Capacity source evidence changed');
  required(Array.isArray(row.legacyBucketIds) && new Set(row.legacyBucketIds).size === row.legacyBucketIds.length, 'Explicit unique legacyBucketIds are required');
  // Native agy /usage groups Flash and Pro under shared weekly and 5-hour limits.
  // Unknown Claude keys remain applicable until their independent scope is known.
  const separateClaude = new Set(['fable', 'opus', 'sonnet', 'haiku'].map(model => `claude/weekly-${model}`));
  const known = legacy.buckets.filter(item => pair.vendor === 'openai' ? item.bucketId.startsWith('codex/') : pair.vendor === 'anthropic'
    ? item.bucketId.startsWith('claude/') && (!separateClaude.has(item.bucketId) || item.bucketId === `claude/weekly-${pair.model}`)
    : item.bucketId.startsWith('gemini/'));
  required(known.every(item => row.legacyBucketIds.includes(item.bucketId)), 'Capacity mapping omits a known matching/shared legacy bucket');
  const prefix = pair.vendor === 'openai' ? 'codex/' : pair.vendor === 'anthropic' ? 'claude/' : 'gemini/';
  for (const id of row.legacyBucketIds) {
    const prior = legacy.buckets.find(item => item.bucketId === id);
    required(prior && id.startsWith(prefix), 'Unknown or cross-vendor legacy capacity mapping');
    if (prior.status === 'exhausted') required(Number.isFinite(Date.parse(prior.asOf)) && observed > Date.parse(prior.asOf), 'Known exhaustion requires a later admitted reading');
  }
  return row;
}

// Admission is file-backed and read-only. Call revalidate directly before native spawn.
function admitCapacity(options, pair, maxWallMs, env = process.env) {
  try {
    required(Number.isSafeInteger(maxWallMs) && maxWallMs > 0, 'A positive planned native timeout is required');
    const capacity = options.capacity || env.MAGI_CAPACITY_RECEIPT;
    const legacyCapacity = options.legacyCapacity || env.MAGI_LEGACY_CAPACITY;
    for (const file of [capacity, legacyCapacity]) {
      required(path.isAbsolute(file || ''), 'Absolute --capacity and --legacy-capacity files are required for native launch');
      assertPlainPath(file);
      required(fs.statSync(file).isFile(), 'Capacity inputs must be regular files');
    }
    const receiptBytes = fs.readFileSync(capacity), legacyBytes = fs.readFileSync(legacyCapacity);
    const receipt = parseJsonBytes(receiptBytes), legacy = parseJsonBytes(legacyBytes);
    const sha = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    const record = { capacity, legacyCapacity, receiptSha256: sha(receiptBytes), legacySha256: sha(legacyBytes), maxWallMs };
    function revalidate() {
      try {
        for (const file of [capacity, legacyCapacity]) assertPlainPath(file);
        required(hashFile(capacity) === record.receiptSha256 && hashFile(legacyCapacity) === record.legacySha256, 'Capacity files changed before native launch');
        const now = Date.now();
        const row = validateCapacity(receipt, legacy, pair, now);
        validateCapacity(receipt, legacy, pair, now + maxWallMs);
        return row;
      } catch (error) { error.code = 'CAPACITY_FAIL'; throw error; }
    }
    const row = revalidate();
    Object.assign(record, { observationId: row.id, observedAt: row.observedAt, expiresAt: row.expiresAt,
      source: row.source, checkedAt: new Date().toISOString() });
    return { record, revalidate };
  } catch (error) { error.code = 'CAPACITY_FAIL'; throw error; }
}

module.exports = { validateCapacity, admitCapacity };
