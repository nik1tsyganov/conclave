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
function probeRecord(root, vendor, model, effort, observedModel = model, completedAt) {
  const directory = path.join(root, `${vendor}-${model}-${effort}`);
  fs.mkdirSync(directory, { recursive: true });
  const native = nativeCapture(vendor, observedModel, effort, CHALLENGE);
  const capture = path.join(directory, 'capture.txt');
  const log = path.join(directory, 'vendor.log');
  fs.writeFileSync(capture, native.capture); fs.writeFileSync(log, native.log);
  completedAt ??= new Date().toISOString();
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

function capacityFixture(root) {
  const source = path.join(root, 'capacity-source.txt');
  fs.writeFileSync(source, 'Fictional test-only included capacity observation');
  const now = Date.now(), matrix = require('./dispatch-matrix.js').loadMatrix();
  const observations = Object.entries(matrix.vendors).map(([vendor, spec]) => ({
    id: vendor + '-fixture', bucketId: vendor + '-included',
    subjects: Object.entries(spec.models).flatMap(([model, value]) => value.efforts.map(effort => ({ vendor, model, effort }))),
    legacyBucketIds: [], observedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 1790000).toISOString(),
    remainingPercent: 50, included: true, paidUsageAuthorized: false,
    source: { kind: 'owner-report', evidencePath: source, evidenceSha256: hashFile(source) },
  }));
  const capacity = path.join(root, 'capacity.json'), legacyCapacity = path.join(root, 'legacy-capacity.json');
  writeJson(capacity, { schemaVersion: 1, observations }); writeJson(legacyCapacity, { buckets: [] });
  return { capacity, legacyCapacity, source };
}

function createSealedRun(t, entries = [{}], options = {}) {
  const root = temporary(t, 'magi-run-');
  const cwd = path.join(root, 'work'); fs.mkdirSync(cwd);
  const matrix = require('./dispatch-matrix.js').loadMatrix();
  const available = allAvailability(path.join(root, 'probes'), matrix);
  const availability = path.join(root, 'available.json'); writeJson(availability, available);
  const dispatches = entries.map((entry, index) => {
    const role = entry.role || 'implement';
    const brief = briefFixture(path.join(root, 'briefs', String(index)), role);
    return { class: 'standard-feature', vendor: 'openai', model: role === 'implement' ? 'gpt-6-astra' : 'gpt-5.6-terra', effort: role === 'implement' ? 'high' : 'medium', routingReason: 'Explicit fixture route preserves the tested vendor contract', role, dispatchId: `d${index + 1}`, unitId: `u${index + 1}`, cwd, brief, briefSha256: hashFile(brief), writeScope: role === 'implement' ? ['result.txt'] : [], ...entry };
  });
  const planObject = { planId: 'fixture-run', hostMode: 'cursor-cli', arbiter: { vendor: 'xai', model: 'grok-4.6', effort: 'high' }, ...options, dispatches };
  const planSource = path.join(root, 'source-plan.json'); writeJson(planSource, planObject);
  const runDir = path.join(root, 'run');
  const profiles = require('./seat-policy.js').loadProfiles();
  const skills = [...new Set(dispatches.flatMap((entry) => require('./seat-policy.js').buildSeatProfile(profiles, entry).skills))];
  const skillSourceRoot = skillFixture(root, skills);
  const sealed = require('./plan-seal.js').sealPlan({ plan: planSource, runDir, availability, skillSourceRoot });
  const { capacity, legacyCapacity } = capacityFixture(root);
  const opts = { plan: sealed.planPath, runDir, rulesRoot: ruleFixture(root), skillSourceRoot, capacity, legacyCapacity };
  return { root, cwd, runDir, opts, dispatches, available, availability, planSource, planObject, sealed };
}

function fakeVendor(action = () => {}, response = 'ACK fixture\nPOSITION: APPROVE\nDone.') {
  let calls = 0;
  const transcripts = new Map();
  const buildLaunch = (opts) => ({ ...opts, vendor: opts.vendor, role: opts.role, binary: process.execPath,
    args: opts.vendor === 'anthropic' ? ['-p', '--safe-mode', '--output-format', 'stream-json', '--verbose', '--json-schema', JSON.stringify(require('./vendor-native.js').CLAUDE_RESPONSE_SCHEMA), '--', require('./cli-adapters.js').seatPointerText({ ...opts, brief: require('./cli-pointer.js').inspectBrief(opts.briefPath) })] : [],
    ...(opts.vendor === 'anthropic' ? { stdio: ['ignore', 'pipe', 'pipe'] } : {}),
    requestedSandbox: opts.requestedSandbox || (opts.role === 'implement' ? 'workspace-write' : 'read-only') });
  const runLaunch = async (launch) => {
    calls++;
    const id = require('node:crypto').randomUUID();
    const instructionRows = syntheticInstructionRows(launch, id);
    transcripts.set(id, { path: path.join(path.dirname(launch.capturePath), 'synthetic-native-source.jsonl'), text: instructionRows.map(row => JSON.stringify(row)).join('\n') + '\n' });
    if (launch.role === 'implement') fs.writeFileSync(path.join(launch.cwd, 'result.txt'), 'implemented');
    await action(launch);
    const model = launch.vendor === 'anthropic' ? require('./dispatch-matrix.js').loadMatrix().vendors.anthropic.models[launch.model].canonical : launch.model;
    const native = nativeCapture(launch.vendor, model, launch.vendor === 'google' ? 'fused-high' : launch.effort, response, launch.requestedSandbox);
    if (launch.vendor === 'anthropic') {
      const terminal = JSON.parse(native.capture);
      terminal.structured_output = { response };
      terminal.result = JSON.stringify(terminal.structured_output);
      native.capture = JSON.stringify(terminal);
    }
    native.capture = native.capture.replaceAll(SESSION, id); native.log = native.log.replaceAll(SESSION, id);
    if (launch.vendor === 'anthropic') native.capture = transcripts.get(id).text + native.capture;
    if (launch.vendor === 'openai') fs.writeFileSync(launch.capturePath, native.capture);
    return { ok: true, exitCode: 0, stdout: launch.vendor === 'openai' ? response : native.capture, stderr: native.log, exitConfirmed: true };
  };
  const collect = id => {
    if (!transcripts.has(id)) throw new Error('missing synthetic native read transcript');
    return transcripts.get(id);
  };
  // Synthetic dispatches authorize only their temporary-filesystem root.
  return { buildLaunch, runLaunch, codexSessionTranscript: collect, googleSessionTranscript: collect,
    checkNativeLaunchState: () => ({ status: 'synthetic-native-state', scope: 'No provider process in this fixture' }),
    calls: () => calls, env: { ...process.env, MAGI_ALLOWED_WORKSPACE_ROOTS: os.tmpdir() } };
}

// Test-only native event fixtures. Production acceptance always runs the same strict validator.
function syntheticInstructionRows(launch, sessionId) {
  const briefDir = path.dirname(launch.briefPath);
  const options = { briefPath: launch.briefPath, seatContractPath: launch.seatContractPath, skillRoot: launch.skillRoot,
    seatProfile: JSON.parse(fs.readFileSync(path.join(path.dirname(launch.seatContractPath), 'seat-profile.json'), 'utf8')),
    rulesManifest: JSON.parse(fs.readFileSync(path.join(briefDir, 'rules-manifest.json'), 'utf8')),
    skillsManifest: JSON.parse(fs.readFileSync(path.join(launch.skillRoot, 'skills-manifest.json'), 'utf8')) };
  const files = require('./instruction-read-evidence.js').collectRequiredInstructionFiles(options).files;
  if (launch.vendor === 'anthropic') return files.flatMap((file, index) => {
    const text = file.text.replaceAll('\r\n', '\n'); const lines = text.split('\n'); const id = `synthetic-read-${index}`;
    return [{ type: 'assistant', session_id: sessionId, message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: file.path } }] } },
      { type: 'user', session_id: sessionId, message: { content: [{ type: 'tool_result', tool_use_id: id,
        content: lines.map((line, n) => `${n + 1}\t${line}`).join('\n') }] },
      tool_use_result: { type: 'text', file: { filePath: file.path, content: text, startLine: 1, numLines: lines.length, totalLines: lines.length } } }];
  });
  if (launch.vendor === 'openai') return [{ type: 'session_meta', payload: { id: sessionId, cwd: launch.cwd } }, ...files.flatMap((file, index) => {
    const cmd = `Get-Content -Raw -LiteralPath '${file.path.replaceAll("'", "''")}' -Encoding UTF8`;
    const args = { cmd, workdir: launch.cwd, max_output_tokens: 10000 }; const output = file.text + '\n'; const id = `synthetic-read-${index}`;
    return [{ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: id,
      input: `const r = await tools.exec_command(${JSON.stringify(args)}); text(r.output);` } },
      { type: 'event_msg', payload: { type: 'item_completed', thread_id: sessionId, item: { type: 'CommandExecution', id: `synthetic-exec-${index}`,
        command: ['powershell.exe', '-Command', cmd], cwd: launch.cwd, status: 'completed', exit_code: 0, stdout: output, stderr: '', formatted_output: output } } },
      { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: id, output: [{ type: 'input_text', text: output }] } }];
  })];
  if (launch.vendor === 'google') {
    const time = new Date().toISOString(); const common = { source: 'MODEL', status: 'DONE', created_at: time };
    const explanation = 'The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.';
    return [{ step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', status: 'DONE', created_at: time, content: 'Synthetic fixture: read the bound brief and contract.' },
      { ...common, step_index: 1, type: 'PLANNER_RESPONSE', tool_calls: files.map(file => ({ name: 'view_file', args: { AbsolutePath: file.path } })) },
      ...files.map((file, index) => {
        const lines = file.text.replaceAll('\r\n', '\n').split('\n');
        return { ...common, step_index: index + 2, type: 'GENERIC', content:
          `Created At: ${time}\nCompleted At: ${time}\nFile Path: \`${require('node:url').pathToFileURL(file.path).href}\`\nTotal Lines: ${lines.length}\nTotal Bytes: ${file.bytes}\nShowing lines 1 to ${lines.length}\n${explanation}\n` +
          lines.map((line, n) => `${n + 1}: ${line}`).join('\n') + '\nThe above content shows the entire, complete file contents of the requested file.\n' };
      })];
  }
  throw new Error('unknown synthetic native vendor');
}
Object.assign(module.exports, { capacityFixture, createSealedRun, fakeVendor });

// Test-only completion: inspect the known synthetic report before attesting it.
// General run options intentionally carry no advance topicality assertion.
async function completeSyntheticDispatch(opts, native) {
  const { runDispatch } = require('./dispatch-run.js');
  const result = await runDispatch(opts, native);
  if (result.status !== 'AWAITING_ATTESTATION') return result;
  const response = fs.readFileSync(result.responsePath, 'utf8');
  require('node:assert/strict').equal(response, require('./vendor-native.js').finalResponse('anthropic', fs.readFileSync(result.capturePath, 'utf8'), { responseProtocol: require('./vendor-native.js').CLAUDE_RESPONSE_PROTOCOL }));
  require('node:assert/strict').equal(result.captureSha256, hashFile(result.capturePath));
  return runDispatch({ ...opts, onTopic: true, captureSha256: result.captureSha256 }, native);
}
module.exports.completeSyntheticDispatch = completeSyntheticDispatch;
