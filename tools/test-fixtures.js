'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hashFile, writeJson } = require('./dispatch-evidence.js');

const SESSION = '10000000-0000-4000-8000-000000000001';
const CHALLENGE = 'MAGI_PROBE_1234567890abcdef1234567890abcdef';
function nativeCapture(vendor, model, effort, response, sandbox = 'read-only') {
  if (vendor === 'openai') return {
    capture: response,
    log: `OpenAI Codex v0.153.4\n--------\nmodel: ${model}\nsandbox: ${sandbox}\nreasoning effort: ${effort}\nsession id: ${SESSION}\n--------\nuser\nA harmless fixture\ncodex\n${response}\ntokens used\n123\n`,
  };
  if (vendor === 'google') return {
    capture: JSON.stringify({ status: 'SUCCESS', conversation_id: SESSION, usage: { input_tokens: 100, output_tokens: 23, total_tokens: 123 }, response }),
    log: `ERROR: logging before google.Init: I0905 12:00:00.000000       1 printmode.go:173] Print mode: starting (promptLength=100, model="${model}", conversationID="")\nERROR: logging before google.Init: I0905 12:00:01.000000       1 session.go:171] Print mode: conversation=${SESSION}, sending message\n`,
  };
  const result = { type: 'result', subtype: 'success', is_error: false, result: response, session_id: SESSION, usage: { input_tokens: 100, output_tokens: 23 }, modelUsage: { [model]: { inputTokens: 100, outputTokens: 23 } } };
  return { capture: JSON.stringify(result), log: JSON.stringify({ type: 'assistant', sessionId: SESSION, effort, message: { model, content: [{ type: 'text', text: response }], usage: { input_tokens: 100, output_tokens: 23 } } }) };
}
function probeRecord(root, vendor, model, effort, observedModel = model) {
  const directory = path.join(root, `${vendor}-${model}-${effort}`);
  fs.mkdirSync(directory, { recursive: true });
  const native = nativeCapture(vendor, observedModel, effort, CHALLENGE);
  const capture = path.join(directory, 'capture.txt');
  const log = path.join(directory, 'vendor.log');
  fs.writeFileSync(capture, native.capture); fs.writeFileSync(log, native.log);
  const completedAt = new Date().toISOString();
  const file = path.join(directory, 'probe.json');
  writeJson(file, { schemaVersion: 1, status: 'PASS', vendor, requestedModel: model, observedModel, effort, challenge: CHALLENGE, capture, log, captureSha256: hashFile(capture), logSha256: hashFile(log), startedAt: completedAt, completedAt });
  return { available: true, vendor, requestedModel: model, observedModel, effort, observedAt: completedAt, evidence: { path: file, sha256: hashFile(file) } };
}
function allAvailability(root, matrix) {
  const result = { schemaVersion: 2, vendors: {} };
  for (const [vendor, spec] of Object.entries(matrix.vendors)) {
    result.vendors[vendor] = { models: {} };
    for (const [model, info] of Object.entries(spec.models)) {
      const efforts = {};
      for (const effort of info.efforts) efforts[effort] = probeRecord(root, vendor, model, effort, info.canonical || model);
      result.vendors[vendor].models[model] = { efforts };
    }
  }
  return result;
}
function temporary(t, prefix = 'magi-contract-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function briefFixture(root, role = 'implement') {
  const brief = path.join(root, 'BRIEF.md');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(brief, `ACK fixture\nSCOPE: result.txt in the assigned worktree.\nhostMode: cursor-cli\nRead STANDING.md, RULES/INDEX.md, SEAT-CONTRACT.md and skills-manifest.json.\npointer-only leaf seat. ${role === 'implement' ? 'implement' : 'read-only; do not modify product files'}.\nWRITE AUDIT R07 receipt ACK telemetry vendor-native proof R11 R20 R21 casper_via=agy R16\n`);
  return brief;
}
function ruleFixture(root) {
  const rulesRoot = path.join(root, 'rules-source');
  fs.mkdirSync(path.join(rulesRoot, 'RULES'), { recursive: true });
  fs.writeFileSync(path.join(rulesRoot, 'STANDING.md'), 'MAGI-CLI-STANDING v2 — Read this file and RULES/INDEX.md in full before task work.\n');
  fs.writeFileSync(path.join(rulesRoot, 'VENDOR.md'), 'openai Codex; anthropic Claude; google agy; xai arbiter only.\n');
  const names = [];
  for (let i = 1; i <= 22; i++) { const name = `R${String(i).padStart(2, '0')}-fixture.md`; names.push(name); fs.writeFileSync(path.join(rulesRoot, 'RULES', name), `Fixture R${i}\n`); }
  fs.writeFileSync(path.join(rulesRoot, 'RULES', 'INDEX.md'), names.join('\n'));
  return rulesRoot;
}
function skillFixture(root, skills) {
  const source = path.join(root, 'skill-source');
  for (const skill of skills) { fs.mkdirSync(path.join(source, skill), { recursive: true }); fs.writeFileSync(path.join(source, skill, 'SKILL.md'), `# ${skill}\nFixture role skill.\n`); }
  return source;
}
module.exports = { allAvailability, briefFixture, nativeCapture, probeRecord, ruleFixture, skillFixture, temporary };

function createSealedRun(t, entries = [{}], options = {}) {
  const root = temporary(t, 'magi-run-');
  const cwd = path.join(root, 'work'); fs.mkdirSync(cwd);
  const matrix = require('./dispatch-matrix.js').loadMatrix();
  const available = allAvailability(path.join(root, 'probes'), matrix);
  const availability = path.join(root, 'available.json'); writeJson(availability, available);
  const dispatches = entries.map((entry, index) => {
    const role = entry.role || 'implement';
    const brief = briefFixture(path.join(root, 'briefs', String(index)), role);
    return { class: 'standard-feature', vendor: 'openai', model: 'gpt-5.6-terra', effort: 'medium', role, dispatchId: `d${index + 1}`, unitId: `u${index + 1}`, cwd, brief, briefSha256: hashFile(brief), writeScope: role === 'implement' ? ['result.txt'] : [], ...entry };
  });
  const planObject = { planId: 'fixture-run', hostMode: 'cursor-cli', arbiter: { vendor: 'xai', model: 'grok-4.6', effort: 'high' }, ...options, dispatches };
  const planSource = path.join(root, 'source-plan.json'); writeJson(planSource, planObject);
  const runDir = path.join(root, 'run');
  const sealed = require('./plan-seal.js').sealPlan({ plan: planSource, runDir, availability });
  const profiles = require('./seat-policy.js').loadProfiles();
  const skills = [...new Set(dispatches.flatMap((entry) => require('./seat-policy.js').buildSeatProfile(profiles, entry).skills))];
  const opts = { plan: sealed.planPath, runDir, rulesRoot: ruleFixture(root), skillSourceRoot: skillFixture(root, skills), onTopic: true };
  return { root, cwd, runDir, opts, dispatches, available, availability, planSource, planObject, sealed };
}

function fakeVendor(action = () => {}, response = 'ACK fixture\nPOSITION: APPROVE\nDone.') {
  let calls = 0;
  const buildLaunch = (opts) => ({ ...opts, vendor: opts.vendor, role: opts.role, binary: process.execPath, args: [], requestedSandbox: opts.role === 'implement' ? 'workspace-write' : 'read-only' });
  const runLaunch = async (launch) => {
    calls++;
    if (launch.role === 'implement') fs.writeFileSync(path.join(launch.cwd, 'result.txt'), 'implemented');
    await action(launch);
    const model = launch.vendor === 'anthropic' ? require('./dispatch-matrix.js').loadMatrix().vendors.anthropic.models[launch.model].canonical : launch.model;
    const native = nativeCapture(launch.vendor, model, launch.vendor === 'google' ? 'fused-high' : launch.effort, response, launch.requestedSandbox);
    const id = require('node:crypto').randomUUID();
    native.capture = native.capture.replaceAll(SESSION, id); native.log = native.log.replaceAll(SESSION, id);
    if (launch.vendor === 'openai') fs.writeFileSync(launch.capturePath, native.capture);
    return { ok: true, exitCode: 0, stdout: launch.vendor === 'openai' ? response : native.capture, stderr: native.log, exitConfirmed: true };
  };
  return { buildLaunch, runLaunch, calls: () => calls };
}
Object.assign(module.exports, { createSealedRun, fakeVendor });
