'use strict';

const VENDORS = Object.freeze(['anthropic', 'openai', 'google']);
const ROLES = Object.freeze(['implement', 'verify', 'review']);
const HOST_MODES = Object.freeze(['cursor', 'cursor-cli']);

function fail(message) {
  const error = new Error(message);
  error.code = 'SCHEMA_ERROR';
  throw error;
}

function positiveNumberOrNull(value, field) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail(`invalid ${field}`);
}

function validateDispatchRow(row, options = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail('row must be a JSON object');
  if (!VENDORS.includes(row.vendor)) fail(`invalid vendor: ${row.vendor}`);
  if (!ROLES.includes(row.role)) fail(`invalid role: ${row.role}`);
  if (row.hostMode !== undefined && !HOST_MODES.includes(row.hostMode)) fail(`invalid hostMode: ${row.hostMode}`);
  if (row.routedBy !== undefined && row.routedBy !== 'arbiter') fail('invalid routedBy');
  if (row.capturedBy !== undefined && row.capturedBy !== 'lead') fail('invalid capturedBy');
  if (options.requireCursorCli && row.hostMode !== 'cursor-cli') fail('hostMode must be cursor-cli');
  if (options.requireArbiter && row.routedBy !== 'arbiter') fail('routedBy must be arbiter');
  if (options.requireDispatchId && (typeof row.dispatchId !== 'string' || row.dispatchId.length === 0)) fail('dispatchId required');
  if (options.requireUnitId && (typeof row.unitId !== 'string' || row.unitId.length === 0)) fail('unitId required');
  if (options.requireProof && (typeof row.proofId !== 'string' || row.proofId.length === 0)) fail('proofId required');
  positiveNumberOrNull(row.vendorSideTokens, 'vendorSideTokens');
  positiveNumberOrNull(row.totalTokens, 'totalTokens');
  if (row.date !== undefined) {
    if (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) fail('invalid date');
    const parsed = new Date(`${row.date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== row.date) fail('invalid date');
  }
  return row;
}

module.exports = { HOST_MODES, ROLES, VENDORS, validateDispatchRow };
