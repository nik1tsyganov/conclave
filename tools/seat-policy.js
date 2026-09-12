#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PROFILES = require('./runtime-paths.js').resolveRuntimePaths().seatProfilesPath;

function policyError(message) {
  const error = new Error(message);
  error.code = 'SEAT_POLICY_FAIL';
  return error;
}

function loadProfiles(file = DEFAULT_PROFILES) {
  const profiles = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  validateOperationalLessons(profiles);
  return profiles;
}

function validateOperationalLessons(profiles) {
  if (profiles?.schemaVersion === 6) return [];
  const catalog = profiles?.operationalLessons;
  const fail = message => { throw policyError(`operational lessons: ${message}`); };
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' && value.trim().length > 0 && value === value.trim();
  function list(value, allowed, label, empty = false) {
    if (!Array.isArray(value) || (!empty && !value.length) || new Set(value).size !== value.length ||
        value.some(item => !text(item) || (allowed && !allowed.includes(item)))) fail(`invalid ${label}`);
  }
  if (profiles?.schemaVersion !== 7 || !object(catalog) || catalog.schemaVersion !== 1 ||
      Object.keys(catalog).some(key => !['schemaVersion', 'entries'].includes(key)) ||
      !Array.isArray(catalog.entries) || !catalog.entries.length) fail('schema 7 requires catalog schema 1');
  const ids = new Set();
  for (const entry of catalog.entries) {
    if (!object(entry) || Object.keys(entry).some(key => !['id', 'procedure', 'fields', 'severity', 'delivery', 'enforcement', 'limit', 'roles', 'vendors'].includes(key))) fail('unknown entry field');
    if (typeof entry.id !== 'string' || !/^[a-z][a-z0-9-]{0,95}$/.test(entry.id) || ids.has(entry.id)) fail('invalid or duplicate id');
    ids.add(entry.id);
    if (!text(entry.procedure) || entry.procedure.length > 512 || /[\r\n\x00]/.test(entry.procedure)) fail('procedure must be one nonblank line of at most 512 characters');
    list(entry.fields, ['powershell', 'electron', 'renderer', 'encoding', 'shell-escaping', 'hooks', 'workflow', 'dispatch', 'vault', 'research', 'docs'], 'fields');
    list(entry.delivery, ['seat', 'arbiter', 'maintainer'], 'delivery');
    if (!['critical', 'high', 'normal'].includes(entry.severity)) fail('invalid severity');
    if (entry.roles !== undefined) list(entry.roles, ['implement', 'review', 'verify', 'plan', 'research'], 'roles');
    if (entry.vendors !== undefined) list(entry.vendors, ['openai', 'anthropic', 'google'], 'vendors');
    if (!object(entry.enforcement) || Object.keys(entry.enforcement).some(key => !['mode', 'code', 'tests'].includes(key)) ||
        !['prevention', 'acceptance', 'detection', 'source-only', 'guidance', 'external-limit', 'historical-limit'].includes(entry.enforcement.mode)) fail('invalid enforcement');
    list(entry.enforcement.code, null, 'enforcement code', true);
    list(entry.enforcement.tests, null, 'enforcement tests', true);
    if (!text(entry.limit)) fail('missing limit');
  }
  return catalog.entries;
}

function expectedSkills(profiles, { vendor, role, className }) {
  const base = profiles.baseSkills?.[vendor];
  const roleSkills = profiles.roleSkills?.[role];
  const classSkills = profiles.classSkills?.[className];
  if (!Array.isArray(base)) throw policyError(`unknown seat vendor: ${vendor}`);
  if (!Array.isArray(roleSkills)) throw policyError(`unknown seat role: ${role}`);
  if (!Array.isArray(classSkills)) throw policyError(`unknown seat class: ${className}`);
  return [...new Set([...base, ...roleSkills, ...classSkills])];
}

function validateSeat(profiles, seat) {
  const lessons = validateOperationalLessons(profiles).filter(entry => entry.delivery.includes('seat') &&
    (!entry.roles || entry.roles.includes(seat.role)) && (!entry.vendors || entry.vendors.includes(seat.vendor)))
    .map(({ id, procedure }) => ({ id, procedure }));
  if (lessons.map(entry => `${entry.id}: ${entry.procedure}`).join('\n').length > 2048) throw policyError('selected lesson text exceeds 2048 characters');
  const vendorSpec = profiles.vendors?.[seat.vendor];
  if (!vendorSpec) throw policyError(`unknown seat vendor: ${seat.vendor}`);
  if (!vendorSpec.roles.includes(seat.role)) throw policyError(`${seat.vendor} may not perform role ${seat.role}`);
  if (seat.subdispatch === true) throw policyError('seat sub-dispatch is forbidden');
  if (seat.arbiter === true) throw policyError('arbiter may not occupy a seat');

  const expected = expectedSkills(profiles, {
    vendor: seat.vendor,
    role: seat.role,
    className: seat.class,
  });
  const supplied = Array.isArray(seat.skills) ? [...new Set(seat.skills)] : expected;
  const forbidden = profiles.forbiddenSeatSkills.filter((skill) => supplied.includes(skill));
  if (forbidden.length) throw policyError(`forbidden seat skills: ${forbidden.join(', ')}`);
  const missing = expected.filter((skill) => !supplied.includes(skill));
  if (missing.length) throw policyError(`seat missing required skills: ${missing.join(', ')}`);
  const extras = supplied.filter((skill) => !expected.includes(skill));
  if (extras.length) throw policyError(`seat skills exceed allow-list: ${extras.join(', ')}`);

  return {
    ok: true,
    vendor: seat.vendor,
    role: seat.role,
    class: seat.class,
    skills: expected,
    permissionProfile: vendorSpec.writePermission[seat.role],
    proofFields: vendorSpec.proof,
    ...(profiles.schemaVersion === 7 ? { lessons } : {}),
  };
}

function buildSeatProfile(profiles, seat) {
  const skills = expectedSkills(profiles, {
    vendor: seat.vendor,
    role: seat.role,
    className: seat.class,
  });
  return validateSeat(profiles, { ...seat, skills });
}

module.exports = {
  DEFAULT_PROFILES,
  buildSeatProfile,
  expectedSkills,
  loadProfiles,
  validateOperationalLessons,
  validateSeat,
};
