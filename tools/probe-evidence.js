// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
const fs = require('node:fs');
const { hashFile } = require('./dispatch-evidence.js');
const { verifyProof } = require('./cli-proof.js');
const { finalResponse } = require('./vendor-native.js');

function challengeMatches(response, challenge) {
  if (typeof challenge !== 'string' || !/^CONCLAVE_PROBE_[a-f0-9]{32}$/.test(challenge)) return false;
  // agy can apply its native ANSWER wrapper. Match one complete response line,
  // never prompt text or an arbitrary substring containing the challenge.
  const lines = response.split(/\r?\n/).map((line) => line.trim());
  return lines.filter((line) => line === challenge || line === `ANSWER: ${challenge}`).length === 1;
}

function verifyProbe(file, { vendor, model, effort, observedModel = model, maxAgeMinutes = 60, nowMs = Date.now() }) {
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.status !== 'PASS' || record.vendor !== vendor || record.requestedModel !== model || record.effort !== effort || record.observedModel !== observedModel) throw new Error('probe route identity mismatch');
  const started = Date.parse(record.startedAt);
  const completed = Date.parse(record.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started || completed > nowMs + 30000 || nowMs - started > maxAgeMinutes * 60000) throw new Error('probe has stale/invalid timestamp');
  if (hashFile(record.capture) !== record.captureSha256 || hashFile(record.log) !== record.logSha256) throw new Error('probe artifact hash mismatch');
  const proof = verifyProof({ vendor, capture: record.capture, log: record.log, expectedModel: model, expectedObservedModel: observedModel, expectedEffort: effort, expectedSandbox: vendor === 'openai' ? 'read-only' : undefined, onTopic: true });
  if (proof.modelObserved !== record.observedModel) throw new Error('probe observation disagrees with native evidence');
  if (!challengeMatches(finalResponse(vendor, fs.readFileSync(record.capture, 'utf8')), record.challenge)) throw new Error('probe challenge mismatch');
  return record;
}
module.exports = { challengeMatches, verifyProbe };
