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
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
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
  validateSeat,
};
