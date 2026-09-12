'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { collectRequiredInstructionFiles, verifyInstructionReadEvidence } = require('./instruction-read-evidence.js');
const { createSealedRun } = require('./test-fixtures.js');
const { stageRules } = require('./cli-rules-stage.js');
const { stageSeatSkills } = require('./cli-skill-stage.js');
const { buildSeatProfile, loadProfiles } = require('./seat-policy.js');
const { seatContractText } = require('./dispatch-run.js');
const SESSION = '10000000-0000-4000-8000-000000000001';

function fixture(t) {
  const run = createSealedRun(t);
  const evidence = path.join(run.runDir, 'out/d1'); const briefPath = path.join(evidence, 'brief/BRIEF.md');
  fs.mkdirSync(path.dirname(briefPath), { recursive: true }); fs.copyFileSync(run.dispatches[0].brief, briefPath);
  const ruleStage = stageRules({ briefPath, rulesRoot: run.opts.rulesRoot });
  const seatProfile = buildSeatProfile(loadProfiles(), run.dispatches[0]);
  const skillStage = stageSeatSkills({ skills: seatProfile.skills, sourceRoot: run.opts.skillSourceRoot, destinationRoot: path.join(evidence, 'skills') });
  const seatContractPath = path.join(evidence, 'SEAT-CONTRACT.md');
  fs.writeFileSync(seatContractPath, seatContractText({ ...run.dispatches[0], planId: run.planObject.planId,
    planHash: run.sealed.planHash }, seatProfile, skillStage, ruleStage));
  const options = { briefPath, seatContractPath, skillRoot: skillStage.root, seatProfile, expectedCwd: run.cwd,
    rulesManifest: ruleStage.manifest, skillsManifest: skillStage.manifest, sessionId: SESSION };
  return { run, options, files: collectRequiredInstructionFiles(options).files };
}
function claudeRows(f) {
  return f.files.flatMap((file, index) => {
    const text = file.text.replaceAll('\r\n', '\n'); const lines = text.split('\n'); const id = `read-${index}`;
    return [{ type: 'assistant', session_id: SESSION, message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: file.path } }] } },
      { type: 'user', session_id: SESSION, message: { content: [{ type: 'tool_result', tool_use_id: id,
        content: lines.map((line, n) => `${n + 1}\t${line}`).join('\n') }] },
      tool_use_result: { type: 'text', file: { filePath: file.path, content: text, startLine: 1, numLines: lines.length, totalLines: lines.length } } }];
  });
}
function codexRows(f, { omitWorkdir = false } = {}) {
  return [{ type: 'session_meta', payload: { id: SESSION, session_id: SESSION, cwd: f.run.cwd } }, ...f.files.flatMap((file, index) => {
    const cmd = `Get-Content -Raw -LiteralPath '${file.path.replaceAll("'", "''")}' -Encoding UTF8`;
    const args = { cmd, ...(omitWorkdir ? {} : { workdir: f.run.cwd }), max_output_tokens: 10000 };
    const output = file.text + '\n'; const callId = `read-${index}`;
    return [{ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: callId,
      input: `const r = await tools.exec_command(${JSON.stringify(args)});\ntext(r.output);` } },
    { type: 'event_msg', payload: { type: 'item_completed', thread_id: SESSION, item: { type: 'CommandExecution', id: `exec-${index}`,
      command: [path.join(f.run.root, 'pwsh.exe'), '-Command', cmd], cwd: pathToFileURL(f.run.cwd).href,
      status: 'completed', exit_code: 0, stdout: output, stderr: '', formatted_output: output } } },
    { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: callId,
      output: [{ type: 'input_text', text: 'Script completed\nOutput:\n' }, { type: 'input_text', text: output }] } }];
  })];
}
function verify(f, vendor, rows) {
  const text = rows.map(row => JSON.stringify(row)).join('\n');
  return verifyInstructionReadEvidence({ ...f.options, vendor,
    ...(vendor === 'google' ? { googleTranscriptBinding: { conversationId: SESSION, sha256: crypto.createHash('sha256').update(text).digest('hex') } } : {}),
    [vendor === 'anthropic' ? 'captureText' : 'transcriptText']: text });
}

test('Codex accepts omitted workdir only with complete native reads at the expected cwd', t => {
  const f = fixture(t);
  assert.equal(verify(f, 'openai', codexRows(f, { omitWorkdir: true })).status, 'PASS');
  assert.equal(verify(f, 'openai', codexRows(f)).status, 'PASS', 'legacy explicit workdir remains valid');
});

for (const [label, mutate] of Object.entries({
  'missing native cwd': rows => { delete rows[2].payload.item.cwd; },
  'wrong native cwd': (rows, f) => { rows[2].payload.item.cwd = f.run.root; },
  'unsafe native cwd': (rows, f) => { rows[2].payload.item.cwd = f.run.cwd + '\u0008'; },
  'wrong explicit workdir': (rows, f, args) => { args.workdir = f.run.root; },
  'null explicit workdir': (rows, f, args) => { args.workdir = null; },
  'empty explicit workdir': (rows, f, args) => { args.workdir = ''; },
  'control character in explicit workdir': (rows, f, args) => { args.workdir = f.run.cwd + '\u0008'; },
  'unknown read argument': (rows, f, args) => { args.login = false; },
  'injected read command': (rows, f, args) => { args.cmd += '; Write-Output fabricated'; rows[2].payload.item.command[2] = args.cmd; },
})) {
  test(`Codex omitted-workdir recipe rejects ${label}`, t => {
    const f = fixture(t), rows = codexRows(f, { omitWorkdir: true });
    const args = { cmd: rows[2].payload.item.command[2], max_output_tokens: 10000 };
    mutate(rows, f, args);
    rows[1].payload.input = `const r = await tools.exec_command(${JSON.stringify(args)}); text(r.output);`;
    assert.throws(() => verify(f, 'openai', rows), { code: 'INSTRUCTION_READ_FAIL' });
  });
}

test('Codex rejects internally consistent cwd forgery against the expected dispatch cwd', t => {
  const f = fixture(t), rows = codexRows(f);
  rows[0].payload.cwd = f.run.root;
  for (const row of rows) {
    if (row.payload?.type === 'custom_tool_call') {
      const args = JSON.parse(row.payload.input.match(/tools\.exec_command\((\{[^\n]+\})\)/)[1]);
      args.workdir = f.run.root;
      row.payload.input = `const r = await tools.exec_command(${JSON.stringify(args)}); text(r.output);`;
    } else if (row.payload?.item?.type === 'CommandExecution') row.payload.item.cwd = pathToFileURL(f.run.root).href;
  }
  assert.throws(() => verify(f, 'openai', rows), { code: 'INSTRUCTION_READ_FAIL' });
});

test('Codex read proof requires an expected dispatch cwd', t => {
  const f = fixture(t); delete f.options.expectedCwd;
  assert.throws(() => verify(f, 'openai', codexRows(f)), { code: 'INSTRUCTION_READ_FAIL' });
});

function googleRows(f) {
  const time = '2026-09-06T07:47:54Z';
  const common = { source: 'MODEL', status: 'DONE', created_at: time };
  const explanation = 'The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.';
  return [{ step_index: 0, type: 'USER_INPUT', source: 'USER_EXPLICIT', status: 'DONE', created_at: time, content: 'Read the bound brief and contract.' },
    { ...common, step_index: 1, type: 'PLANNER_RESPONSE', tool_calls: f.files.map(file => ({ name: 'view_file', args: { AbsolutePath: file.path } })) },
    ...f.files.map((file, index) => {
      const lines = file.text.replaceAll('\r\n', '\n').split('\n');
      return { ...common, step_index: index + 2, type: 'GENERIC', content:
        `Created At: ${time}\nCompleted At: ${time}\nFile Path: \`${pathToFileURL(file.path).href}\`\nTotal Lines: ${lines.length}\nTotal Bytes: ${file.bytes}\nShowing lines 1 to ${lines.length}\n${explanation}\n` +
        lines.map((line, n) => `${n + 1}: ${line}`).join('\n') + '\nThe above content shows the entire, complete file contents of the requested file.\n' };
    })];
}

test('one initial native capture BOM is accepted and retained in evidence hash', t => {
  const f = fixture(t);
  const captureText = '\uFEFF' + claudeRows(f).map(row => JSON.stringify(row)).join('\n');
  const result = verifyInstructionReadEvidence({ ...f.options, vendor: 'anthropic', captureText });
  assert.equal(result.status, 'PASS');
  assert.equal(result.evidenceSha256, crypto.createHash('sha256').update(captureText).digest('hex'));
});

for (const [label, decorate] of Object.entries({
  'duplicate initial BOM': text => '\uFEFF\uFEFF' + text,
  'midstream BOM': text => text.replace('\n', '\n\uFEFF'),
  'standalone midstream BOM': text => text.replace('\n', '\n\uFEFF\n'),
})) {
  test(`native capture rejects ${label}`, t => {
    const f = fixture(t);
    const captureText = decorate(claudeRows(f).map(row => JSON.stringify(row)).join('\n'));
    assert.throws(() => verifyInstructionReadEvidence({ ...f.options, vendor: 'anthropic', captureText }), /malformed or truncated JSON/);
  });
}

test('trusted required set includes bound brief, contract, both manifests, every rule and every allowed SKILL.md', t => {
  const f = fixture(t);
  assert.equal(f.files.length, 29 + f.options.seatProfile.skills.length);
  assert.equal(f.files.filter(file => /R\d{2}-fixture.md$/.test(file.path)).length, 22);
  assert.ok(f.options.seatProfile.skills.every(skill => f.files.some(file => file.path.endsWith(skill + path.sep + 'SKILL.md'))));
  assert.throws(() => collectRequiredInstructionFiles({ ...f.options, rulesManifest: undefined }), /trusted staging manifests/);
  const manifestFile = path.join(f.options.skillRoot, 'skills-manifest.json');
  const changed = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); changed.skills.testing[0].sha256 = 'a'.repeat(64);
  fs.writeFileSync(manifestFile, JSON.stringify(changed));
  assert.throws(() => collectRequiredInstructionFiles(f.options), /trusted instruction inputs/);
});
test('Windows contract path case aliases bind the same required files', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const text = fs.readFileSync(f.options.seatContractPath, 'utf8');
  fs.writeFileSync(f.options.seatContractPath, text.replaceAll(f.run.root, f.run.root.toLowerCase()));
  f.files = collectRequiredInstructionFiles(f.options).files;
  assert.equal(verify(f, 'anthropic', claudeRows(f)).status, 'PASS');
});
test('required pointers must occupy their bound fields, not appear only in unrelated prose', t => {
  const f = fixture(t);
  const text = fs.readFileSync(f.options.seatContractPath, 'utf8');
  fs.writeFileSync(f.options.seatContractPath, text.replace('- STANDING.md: ', 'Unrelated mention: '));
  assert.throws(() => collectRequiredInstructionFiles(f.options), /missing a required staged instruction pointer/);
});

for (const vendor of ['anthropic', 'openai']) {
  const makeRows = vendor === 'anthropic' ? claudeRows : codexRows;
  test(`${vendor} complete native reads return bound per-file evidence without claiming application`, t => {
    const f = fixture(t); const result = verify(f, vendor, makeRows(f));
    assert.equal(result.status, 'PASS'); assert.equal(result.files.length, f.files.length);
    assert.match(result.evidenceSha256, /^[a-f0-9]{64}$/); assert.equal(result.applicationProven, undefined);
    assert.ok(result.files.every(file => file.requestEvent < file.resultEvent));
  });
  test(`${vendor} ACK, final claimed reads, nonce and path mentions provide no native read coverage`, t => {
    const f = fixture(t);
    const rows = vendor === 'anthropic' ? [{ type: 'assistant', session_id: SESSION, message: { content: [{ type: 'text',
      text: 'ACK. I read all instructions. NONCE. ' + f.files.map(file => file.path).join(', ') }] } }] :
      [{ type: 'session_meta', payload: { id: SESSION, cwd: f.run.cwd } }, { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ACK. Read every file. NONCE.' }] } }];
    assert.throws(() => verify(f, vendor, rows), /reads are missing/);
  });
  test(`${vendor} rejects changed staged content even when a new native response repeats it`, t => {
    const f = fixture(t); const rows = makeRows(f);
    fs.appendFileSync(path.join(f.options.skillRoot, 'testing/SKILL.md'), 'changed');
    assert.throws(() => verify(f, vendor, rows), /trusted instruction inputs/);
  });
}

for (const [label, mutate] of Object.entries({
  'failed Read': rows => { rows[1].message.content[0].is_error = true; },
  'wrong session': rows => { rows[1].session_id = 'another-session'; },
  'partial line coverage': rows => { rows[1].tool_use_result.file.startLine = 2; },
  'false total lines': rows => { rows[1].tool_use_result.file.totalLines++; },
  'different native text': rows => { rows[1].tool_use_result.file.content += 'changed'; },
  'truncated delivered text': rows => { rows[1].message.content[0].content = 'Output truncated'; },
  'missing successful result': rows => { rows.splice(1, 1); },
  'conflicting duplicate result': rows => { rows.splice(2, 0, structuredClone(rows[1])); },
  'unknown task tool before coverage': rows => { rows.unshift({ type: 'assistant', session_id: SESSION, message: { content: [{ type: 'tool_use', id: 'edit', name: 'Edit', input: {} }] } }); },
})) {
  test(`Claude rejects ${label}`, t => { const f = fixture(t); const rows = claudeRows(f); mutate(rows); assert.throws(() => verify(f, 'anthropic', rows), { code: 'INSTRUCTION_READ_FAIL' }); });
}

for (const [label, mutate] of Object.entries({
  'failed exit': rows => { rows[2].payload.item.exit_code = 1; },
  'wrong native session': rows => { rows[2].payload.thread_id = 'another-session'; },
  'wrong transcript session': rows => { rows[0].payload.id = 'another-session'; },
  'missing native execution ID': rows => { delete rows[2].payload.item.id; },
  'reused native execution ID': rows => { rows[5].payload.item.id = rows[2].payload.item.id; },
  'truncated stdout': rows => { rows[2].payload.item.stdout = 'truncated'; },
  'changed formatted output': rows => { rows[2].payload.item.formatted_output = 'truncated'; },
  'complete stdout but truncated model-facing output': rows => { rows[3].payload.output[1].text = 'truncated'; },
  'mismatched delivered call ID': rows => { rows[3].payload.call_id = 'other'; },
  'echo instead of real native read': rows => { rows[2].payload.item.command[2] = 'echo claimed read'; },
  'missing native command record': rows => { rows.splice(2, 1); },
  'UTF8 flag omitted': rows => { rows[1].payload.input = rows[1].payload.input.replace(' -Encoding UTF8', ''); },
  'arbitrary wrapper evaluation': rows => { rows[1].payload.input += '\ntext("fabricated");'; },
  'product mutation before required reads': rows => { rows.splice(1, 0, { type: 'event_msg', payload: { type: 'item_completed', thread_id: SESSION, item: { type: 'CommandExecution', command: ['pwsh.exe', '-Command', 'Set-Content product.txt changed'], status: 'completed', exit_code: 0 } } }); },
  'native file-change event before required reads': rows => { rows.splice(1, 0, { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'FileChange', changes: [{ path: 'product.txt' }] } } }); },
})) {
  test(`Codex rejects ${label}`, t => { const f = fixture(t); const rows = codexRows(f); mutate(rows); assert.throws(() => verify(f, 'openai', rows), { code: 'INSTRUCTION_READ_FAIL' }); });
}

test('Google rejects final-only captures without a trusted full-transcript collector binding', () => {
  assert.throws(() => verifyInstructionReadEvidence({ vendor: 'google', sessionId: SESSION,
    captureText: JSON.stringify({ status: 'SUCCESS', response: 'ACK. Read all files.' }) }), { code: 'INSTRUCTION_READ_UNSUPPORTED' });
});

test('malformed native capture fails rather than accepting a complete prefix', t => {
  const f = fixture(t);
  assert.throws(() => verifyInstructionReadEvidence({ ...f.options, vendor: 'anthropic',
    captureText: claudeRows(f).map(row => JSON.stringify(row)).join('\n') + '\n{"type":' }), /malformed or truncated JSON/);
});

test('Codex native UserMessage metadata does not count as product work', t => {
  const f = fixture(t); const rows = codexRows(f);
  rows.splice(1, 0, { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: 'Read the bound instructions.' } } });
  assert.equal(verify(f, 'openai', rows).status, 'PASS');
});

function relativeProductRead(f, index = 99) {
  const cmd = "Get-Content -Raw -LiteralPath 'lib\\d1-sum.js' -Encoding UTF8";
  const args = { cmd, workdir: f.run.cwd, max_output_tokens: 10000 };
  const output = 'function sum(a, b) {\n  return a - b;\n}\n';
  const callId = `product-read-${index}`;
  return [
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: callId,
      input: `const r = await tools.exec_command(${JSON.stringify(args)});\ntext(r.output);` } },
    { type: 'event_msg', payload: { type: 'item_completed', thread_id: SESSION, item: { type: 'CommandExecution', id: `exec-product-${index}`,
      command: [path.join(f.run.root, 'pwsh.exe'), '-Command', cmd], cwd: pathToFileURL(f.run.cwd).href,
      status: 'completed', exit_code: 0, stdout: output, stderr: '', formatted_output: output } } },
    { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: callId,
      output: [{ type: 'input_text', text: 'Script completed\nOutput:\n' }, { type: 'input_text', text: output }] } },
  ];
}

test('Codex accepts a relative product Get-Content after every required instruction read', t => {
  const f = fixture(t);
  const rows = [...codexRows(f), ...relativeProductRead(f)];
  assert.equal(verify(f, 'openai', rows).status, 'PASS');
});

test('Codex treats a relative product Get-Content before coverage as missing reads, not a path-shape crash', t => {
  const f = fixture(t);
  const rows = codexRows(f);
  rows.splice(1, 0, ...relativeProductRead(f));
  assert.throws(() => verify(f, 'openai', rows), (error) => {
    assert.equal(error.code, 'INSTRUCTION_READ_FAIL');
    assert.match(error.message, /reads are missing/);
    assert.doesNotMatch(error.message, /absolute file path/);
    return true;
  });
});

test('Google native view_file batches correlate full content by logical step even when storage rows are reordered', t => {
  const f = fixture(t); const rows = googleRows(f);
  const ordered = verify(f, 'google', rows);
  const reordered = verify(f, 'google', [...rows].reverse());
  assert.equal(ordered.status, 'PASS'); assert.equal(reordered.status, 'PASS');
  assert.equal(ordered.files.length, f.files.length);
  assert.ok(reordered.files.every(file => file.requestStep < file.resultStep));
  assert.equal(reordered.applicationProven, undefined);
});

test('Google accepts gaps and asynchronous product events only after complete instruction coverage', t => {
  const f = fixture(t);
  const reads = googleRows(f);
  const expected = verify(f, 'google', reads).files;
  for (const gap of [0, 1, 8]) {
    const rows = [...reads,
      { step_index: reads.length + gap, type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE', tool_calls: [{ name: 'run_command', args: { CommandLine: 'node --test' } }] },
      { step_index: reads.length + gap + 1, type: 'ASYNC_PRODUCT_EVENT', source: 'SYSTEM' },
      { step_index: reads.length + gap + 3, type: 'GENERIC', source: 'MODEL', status: 'DONE', content: 'Product result' },
    ];
    const result = verify(f, 'google', rows);
    assert.equal(result.status, 'PASS');
    assert.deepEqual(result.files, expected);
    assert.equal(verify(f, 'google', [...rows].reverse()).status, 'PASS');
  }
});

test('Google rejects a logical gap before the final required read result', t => {
  const f = fixture(t); const rows = googleRows(f);
  rows.at(-1).step_index += 1;
  assert.throws(() => verify(f, 'google', rows), { code: 'INSTRUCTION_READ_FAIL' });
});

test('Google retains integer and duplicate step safeguards after instruction coverage', t => {
  const f = fixture(t); const rows = googleRows(f);
  for (const step_index of [rows.length - 1, -1, 1.5, '100', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => verify(f, 'google', [...rows, { step_index, type: 'GENERIC' }]), { code: 'INSTRUCTION_READ_FAIL' });
  }
});

test('Google does not finish coverage while its final required result is missing or invalid', t => {
  const f = fixture(t);
  for (const kind of ['missing', 'altered', 'truncated', 'early product']) {
    const rows = googleRows(f);
    if (kind === 'missing') rows.pop();
    if (kind === 'altered') rows.at(-1).content += 'changed';
    if (kind === 'truncated') rows.at(-1).truncated_fields = ['content'];
    if (kind === 'early product') rows[rows.length - 1] = { step_index: rows.length - 1, type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'run_command', args: {} }] };
    rows.push({ step_index: rows.length, type: 'GENERIC', source: 'MODEL', status: 'DONE', content: 'Product output' });
    assert.throws(() => verify(f, 'google', rows), { code: 'INSTRUCTION_READ_FAIL' });
  }
});

for (const [label, mutate] of Object.entries({
  'missing native result': rows => { rows.splice(2, 1); },
  'duplicate logical step': rows => { rows[2].step_index = rows[1].step_index; },
  'failed result status': rows => { rows[2].status = 'ERROR'; },
  'truncated transcript projection': rows => { rows[2].truncated_fields = ['content']; },
  'truncated content': rows => { rows[2].content = rows[2].content.slice(0, -70); },
  'wrong file URI': rows => { rows[2].content = rows[2].content.replace(/File Path: `[^`]+`/, rows[3].content.match(/File Path: `[^`]+`/)[0]); },
  'wrong native tool': rows => { rows[1].tool_calls[0].name = 'run_command'; },
  'partial request range': rows => { rows[1].tool_calls[0].args.StartLine = 2; },
  'partial returned range': rows => { rows[2].content = rows[2].content.replace('Showing lines 1 to ', 'Showing lines 2 to '); },
  'wrong total bytes': rows => { rows[2].content = rows[2].content.replace(/Total Bytes: \d+/, 'Total Bytes: 1'); },
  'wrong complete file text': rows => { rows[2].content = rows[2].content.replace('1: ACK', '1: BAD'); },
  'result before request in logical order': rows => { [rows[1].step_index, rows[2].step_index] = [rows[2].step_index, rows[1].step_index]; },
  'planner final self-report instead of native result': rows => { rows[2].type = 'PLANNER_RESPONSE'; },
  'unknown tool before required coverage': rows => { rows[1].tool_calls.unshift({ name: 'edit_file', args: { AbsolutePath: 'product.txt' } }); },
  'non-required global read before coverage': (rows, f) => { rows[1].tool_calls.unshift({ name: 'view_file', args: { AbsolutePath: path.join(f.run.root, 'global-context.md') } }); },
})) {
  test(`Google rejects ${label}`, t => { const f = fixture(t); const rows = googleRows(f); mutate(rows, f); assert.throws(() => verify(f, 'google', rows), { code: 'INSTRUCTION_READ_FAIL' }); });
}

test('Google requires matching collector conversation and full transcript digest', t => {
  const f = fixture(t); const transcriptText = googleRows(f).map(row => JSON.stringify(row)).join('\n');
  const sha256 = crypto.createHash('sha256').update(transcriptText).digest('hex');
  for (const googleTranscriptBinding of [undefined, { conversationId: 'wrong', sha256 }, { conversationId: SESSION, sha256: 'a'.repeat(64) }]) {
    assert.throws(() => verifyInstructionReadEvidence({ ...f.options, vendor: 'google', transcriptText, googleTranscriptBinding }), { code: 'INSTRUCTION_READ_UNSUPPORTED' });
  }
});

for (const [label, extra] of Object.entries({
  'custom shell': { shell: 'product/pwsh.exe' },
  'permission override': { sandbox_permissions: 'require_escalated' },
  'login override': { login: false },
  'environment override': { env: { PATH: 'product' } },
  'unbounded output': { max_output_tokens: 20001 },
  'zero output': { max_output_tokens: 0 },
  'fractional output': { max_output_tokens: 1.5 },
  'string output budget': { max_output_tokens: '10000' },
})) {
  test(`Codex rejects ${label} in the native read recipe`, t => {
    const f = fixture(t); const rows = codexRows(f);
    const cmd = rows[2].payload.item.command[2];
    const args = { cmd, workdir: f.run.cwd, max_output_tokens: 10000, ...extra };
    if (extra.shell) {
      args.shell = path.join(f.run.cwd, 'pwsh.exe');
      rows[2].payload.item.command[0] = args.shell;
    }
    rows[1].payload.input = `const r = await tools.exec_command(${JSON.stringify(args)});\ntext(r.output);`;
    assert.throws(() => verify(f, 'openai', rows), { code: 'INSTRUCTION_READ_FAIL' });
  });
}
