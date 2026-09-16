'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');
const { fileURLToPath } = require('node:url');
const { canonicalPlainPath } = require('./runtime-paths.js');
const { verifyStagedRules } = require('./cli-rules-stage.js');
const { verifySeatSkills } = require('./cli-skill-stage.js');

const INSTRUCTION_READ_PROTOCOL = 'magi-native-instruction-reads-v1';
function fail(message, code = 'INSTRUCTION_READ_FAIL') { throw Object.assign(new Error(message), { code }); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function normalize(text) { return text.replaceAll('\r\n', '\n'); }
function plainPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) fail('read evidence requires an absolute file path');
  return canonicalPlainPath(value);
}
function readText(file) {
  plainPath(file);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1) fail('instruction must be a plain file: ' + file);
  const bytes = fs.readFileSync(file);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (!text.trim()) fail('required instruction is empty: ' + file);
  return { path: path.resolve(file), bytes: bytes.length, sha256: hash(bytes), text };
}

// These objects are wrapper-retained staging inputs, never a child's claimed manifest.
function collectRequiredInstructionFiles(options) {
  try {
    const { briefPath, seatContractPath, skillRoot, seatProfile, rulesManifest, skillsManifest } = options;
    if (!rulesManifest || !skillsManifest || !Array.isArray(seatProfile?.skills) || !seatProfile.skills.length) fail('trusted staging manifests and seat profile are required');
    verifyStagedRules(briefPath, rulesManifest);
    verifySeatSkills({ destinationRoot: skillRoot, skills: seatProfile.skills, manifest: skillsManifest });
    const briefDir = path.dirname(plainPath(briefPath));
    const skills = plainPath(skillRoot);
    const contract = readText(seatContractPath);
    const files = [readText(briefPath), contract, readText(path.join(briefDir, 'rules-manifest.json')),
      ...rulesManifest.files.map(entry => readText(path.join(briefDir, entry.path))),
      readText(path.join(skills, 'skills-manifest.json')),
      ...seatProfile.skills.map(skill => readText(path.join(skills, skill, 'SKILL.md')))];
    const pointers = contract.text.match(/^Allowed staged skills:\r?\n((?:- [^\r\n]+(?:\r?\n|$))*)/m);
    const expected = seatProfile.skills.map(skill => `${skill}\0${plainPath(path.join(skills, skill, 'SKILL.md'))}`).sort();
    const actual = pointers?.[1].trimEnd().split(/\r?\n/).map(line => {
      const match = line.match(/^- ([a-z0-9-]+): (.+)$/);
      return match ? `${match[1]}\0${plainPath(match[2])}` : null;
    }).sort();
    if (!actual || JSON.stringify(actual) !== JSON.stringify(expected)) fail('contract skill pointers differ from trusted staging');
    const requiredPointers = [
      ['- STANDING.md: ', path.join(briefDir, 'STANDING.md')], ['- VENDOR.md: ', path.join(briefDir, 'VENDOR.md')],
      ['- RULES/INDEX.md: ', path.join(briefDir, 'RULES', 'INDEX.md')], ['Rules manifest: ', path.join(briefDir, 'rules-manifest.json')],
      ['Skill manifest: ', path.join(skills, 'skills-manifest.json')],
    ];
    const contractLines = contract.text.split(/\r?\n/);
    for (const [label, file] of requiredPointers) {
      const matches = contractLines.filter(line => line.startsWith(label));
      if (matches.length !== 1 || plainPath(matches[0].slice(label.length)) !== plainPath(file)) fail('contract is missing a required staged instruction pointer or names a different file');
    }
    const identities = files.map(file => plainPath(file.path));
    if (new Set(identities).size !== files.length) fail('duplicate required instruction path');
    return { files, requiredSetSha256: hash(JSON.stringify(files.map(({ text, ...entry }) => entry))) };
  } catch (error) {
    if (error.code === 'INSTRUCTION_READ_FAIL') throw error;
    fail('trusted instruction inputs failed: ' + error.message);
  }
}

function records(text) {
  if (typeof text !== 'string' || !text.trim()) fail('native read transcript is missing');
  const jsonl = text.startsWith('\uFEFF') ? text.slice(1) : text;
  try { return jsonl.split(/\r?\n/).filter(line => !/^[\t ]*$/.test(line)).map(line => JSON.parse(line)); }
  catch { fail('native read transcript is malformed or truncated JSON'); }
}
function deliveredText(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value) || value.some(part => !['text', 'input_text'].includes(part.type) || typeof part.text !== 'string')) fail('unsupported model-facing tool output');
  return value.map(part => part.text).join('');
}
function requireComplete(found, required) {
  if (found.size !== required.size) fail('required native instruction reads are missing before product work');
}

function claudeReads(rows, sessionId, required) {
  const calls = new Map(); const found = new Map(); const results = new Set();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const parts = row.message?.content;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (part.type === 'tool_use') {
        if (row.type !== 'assistant' || row.session_id !== sessionId) fail('native Read request session or role mismatch');
        if (part.name !== 'Read') { requireComplete(found, required); continue; }
        const key = plainPath(part.input?.file_path);
        if (!required.has(key)) { requireComplete(found, required); continue; }
        if (!part.id || calls.has(part.id)) fail('duplicate or missing native Read request ID');
        calls.set(part.id, { key, requestEvent: index + 1 });
      } else if (part.type === 'tool_result' && calls.has(part.tool_use_id)) {
        if (row.type !== 'user' || row.session_id !== sessionId || results.has(part.tool_use_id)) fail('native Read result session, role or ID mismatch');
        results.add(part.tool_use_id);
        const call = calls.get(part.tool_use_id); const expected = required.get(call.key);
        const file = row.tool_use_result?.file;
        if (part.is_error === true || row.tool_use_result?.type !== 'text' || !file || plainPath(file.filePath) !== call.key) fail('native Read failed or returned the wrong file');
        const text = normalize(expected.text); const lines = text.split('\n');
        if (file.startLine !== 1 || file.numLines !== lines.length || file.totalLines !== lines.length ||
          typeof file.content !== 'string' || normalize(file.content) !== text) fail('native Read content or full line coverage mismatch');
        const rendered = lines.map((line, n) => `${n + 1}\t${line}`).join('\n');
        if (normalize(deliveredText(part.content)) !== rendered) fail('native Read model-facing output is truncated or changed');
        found.set(call.key, { requestEvent: call.requestEvent, resultEvent: index + 1 });
      }
    }
  }
  if ([...calls.keys()].some(id => !results.has(id))) fail('native Read request has no successful result');
  requireComplete(found, required);
  return found;
}

// The Codex seat proves one whole-file read of an exact literal path, recorded
// in its native transcript. Windows uses PowerShell; POSIX hosts have no pwsh,
// so they use cat. Producers (cli-adapters, dispatch-run) emit these strings.
const POWERSHELL_READ = /^Get-Content -Raw -LiteralPath '((?:[^']|'')+)' -Encoding UTF8$/;
const POSIX_READ = /^cat -- '((?:[^']|'\\'')+)'$/;

function codexReadCommand(file, platform = process.platform) {
  return platform === 'win32'
    ? `Get-Content -Raw -LiteralPath '${file.replaceAll("'", "''")}' -Encoding UTF8`
    : `cat -- '${file.replaceAll("'", "'\\''")}'`;
}

function codexReadTarget(cmd) {
  const windows = cmd.match(POWERSHELL_READ);
  if (windows) return { shell: 'powershell', file: windows[1].replaceAll("''", "'") };
  const posix = cmd.match(POSIX_READ);
  if (posix) return { shell: 'cat', file: posix[1].replaceAll("'\\''", "'") };
  return null;
}

// Both shapes bind the native command to the same literal path; stdout is still
// compared byte-for-byte against the required file below.
function codexNativeCommandMatches(command, pending) {
  if (!Array.isArray(command) || command.length !== 3) return false;
  const shell = path.basename(command[0]);
  // Codex on POSIX runs the recipe through the login shell: ['/bin/zsh', '-lc', cmd].
  // Accept that exact wrapper around the exact recipe string, or a bare cat.
  if (pending.shell === 'cat') {
    if (shell === 'cat') return command[1] === '--' && command[2] === pending.file;
    return /^(?:zsh|bash|sh)$/.test(shell) && /^-l?c$/.test(command[1]) && command[2] === pending.args.cmd;
  }
  return /^(?:pwsh|powershell)(?:\.exe)?$/i.test(shell) && command[1] === '-Command' && command[2] === pending.args.cmd;
}

function codexReadCall(item) {
  if (item.type !== 'custom_tool_call' || item.name !== 'exec' || typeof item.input !== 'string') return null;
  const match = item.input.match(/^\s*const\s+([A-Za-z_]\w*)\s*=\s*await tools\.exec_command\((\{[\s\S]*\})\);\s*text\(\1\.output\);\s*$/);
  if (!match) return null;
  let args;
  try { args = JSON.parse(match[2]); } catch { return null; }
  if (!args || JSON.stringify(Object.keys(args).sort()) !== JSON.stringify(['cmd', 'max_output_tokens', 'workdir']) ||
    typeof args.cmd !== 'string' || typeof args.workdir !== 'string' || !Number.isSafeInteger(args.max_output_tokens) ||
    args.max_output_tokens < 1 || args.max_output_tokens > 20000) return null;
  const target = codexReadTarget(args.cmd);
  if (!target) return null;
  return { args, ...target };
}

function codexReads(rows, sessionId, required) {
  const metadata = rows.filter(row => row.type === 'session_meta');
  if (metadata.length !== 1 || metadata[0].payload?.id !== sessionId ||
    (metadata[0].payload.session_id !== undefined && metadata[0].payload.session_id !== sessionId)) fail('Codex transcript session mismatch');
  const cwd = plainPath(metadata[0].payload.cwd);
  const found = new Map(); const seen = new Set(); const executions = new Set(); let pending = null;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]; const item = row.payload;
    if (row.type === 'response_item' && ['custom_tool_call', 'function_call'].includes(item?.type)) {
      if (pending) fail('ambiguous overlapping Codex tool calls');
      const read = codexReadCall(item);
      if (!read || typeof read.file !== 'string' || !path.isAbsolute(read.file)) {
        requireComplete(found, required);
        continue;
      }
      const key = plainPath(read.file);
      if (!required.has(key)) { requireComplete(found, required); continue; }
      if (!item.call_id || seen.has(item.call_id) || plainPath(read.args.workdir) !== cwd) fail('Codex read call identity or cwd mismatch');
      seen.add(item.call_id);
      pending = { ...read, key, callId: item.call_id, requestEvent: index + 1 };
    } else if (row.type === 'event_msg' && item?.type === 'item_completed' && item.item?.type === 'CommandExecution') {
      const execution = item.item;
      if (!pending) { requireComplete(found, required); continue; }
      const command = execution.command;
      const nativeCwd = execution.cwd?.startsWith('file:') ? fileURLToPath(execution.cwd) : execution.cwd;
      if (pending.execution || !execution.id || executions.has(execution.id) || item.thread_id !== sessionId ||
        !codexNativeCommandMatches(command, pending) ||
        plainPath(nativeCwd) !== cwd || execution.status !== 'completed' || execution.exit_code !== 0 || execution.stderr !== '') fail('Codex native read failed or does not match its tool call');
      executions.add(execution.id);
      const text = normalize(required.get(pending.key).text);
      const output = typeof execution.stdout === 'string' ? normalize(execution.stdout) : null;
      if (output !== text && output !== text + '\n') fail('Codex native read output is partial, truncated or changed');
      if (typeof execution.formatted_output !== 'string' || normalize(execution.formatted_output) !== output) fail('Codex delivered native output differs from stdout');
      pending.execution = { resultEvent: index + 1, output };
    } else if (row.type === 'response_item' && item?.type === 'custom_tool_call_output' && pending) {
      if (item.call_id !== pending.callId || !pending.execution) fail('Codex tool output lacks its successful native read');
      const output = item.output;
      // Code-mode emits a separate trusted result block after its completion header.
      if (!Array.isArray(output) || output.some(part => part.type !== 'input_text' || typeof part.text !== 'string') ||
        !output.some(part => normalize(part.text) === pending.execution.output)) fail('Codex model-facing read output is absent, truncated or changed');
      found.set(pending.key, { requestEvent: pending.requestEvent, resultEvent: pending.execution.resultEvent, deliveredEvent: index + 1 });
      pending = null;
    } else if (row.type === 'event_msg' && item?.item && !['UserMessage', 'AgentMessage', 'Reasoning', 'Plan'].includes(item.item.type)) {
      // Unknown execution/file-change shapes cannot hide work before required reads.
      requireComplete(found, required);
    }
  }
  if (pending) fail('Codex read has no completed native and model-facing output');
  requireComplete(found, required);
  return found;
}

const GOOGLE_LINE_EXPLANATION = 'The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.';
const GOOGLE_COMPLETE_FOOTER = 'The above content shows the entire, complete file contents of the requested file.';

function googleReadResult(row, call, expected) {
  if (row.status !== 'DONE' || row.source !== 'MODEL' || row.truncated_fields !== undefined || typeof row.content !== 'string') fail('Google native read failed or is truncated');
  const text = normalize(row.content);
  const header = text.match(/^Created At: ([^\n]+)\nCompleted At: ([^\n]+)\nFile Path: `([^`\n]+)`\nTotal Lines: (\d+)\nTotal Bytes: (\d+)\nShowing lines (\d+) to (\d+)\n/);
  if (!header) fail('Google native read result has an unsupported file header');
  const uri = new URL(header[3]);
  if (uri.protocol !== 'file:' || uri.hostname || uri.search || uri.hash || plainPath(fileURLToPath(uri)) !== call.key) fail('Google native read result file differs from its request');
  const created = Date.parse(header[1]); const completed = Date.parse(header[2]);
  if (!Number.isFinite(created) || !Number.isFinite(completed) || created < call.createdAt || completed < created || Date.parse(row.created_at) !== created) fail('Google native read timestamps differ or run backwards');
  const lines = normalize(expected.text).split('\n');
  if (Number(header[4]) !== lines.length || Number(header[5]) !== expected.bytes || Number(header[6]) !== 1 || Number(header[7]) !== lines.length) fail('Google native read does not cover the complete file');
  const body = `${GOOGLE_LINE_EXPLANATION}\n${lines.map((line, index) => `${index + 1}: ${line}`).join('\n')}\n${GOOGLE_COMPLETE_FOOTER}\n`;
  if (text.slice(header[0].length) !== body) fail('Google native read content is truncated or changed');
}

function googleReads(rows, required) {
  const ordered = rows.map((row, index) => ({ row, event: index + 1 })).sort((a, b) => a.row.step_index - b.row.step_index);
  if (!ordered.length || ordered.some(({ row }, index) => !Number.isSafeInteger(row.step_index) || row.step_index !== index)) fail('Google native step sequence is incomplete or duplicated');
  if (ordered[0].row.type !== 'USER_INPUT' || ordered[0].row.source !== 'USER_EXPLICIT') fail('Google transcript is missing its initial native user input');
  const found = new Map(); let pending = [];
  for (const { row, event } of ordered) {
    if (row.type === 'USER_INPUT') {
      if (row.step_index !== 0 || pending.length) fail('unexpected Google user input during native read sequence');
    } else if (row.type === 'PLANNER_RESPONSE') {
      if (pending.length) fail('Google native read request is missing its result');
      if (row.tool_calls === undefined) continue; // Never inspect planner prose or hidden thoughts as proof.
      if (row.source !== 'MODEL' || row.status !== 'DONE' || row.truncated_fields !== undefined || !Array.isArray(row.tool_calls)) fail('Google native tool request is incomplete');
      const batch = new Set();
      pending = row.tool_calls.map(call => {
        if (call.name !== 'view_file') { requireComplete(found, required); return null; }
        const key = plainPath(call.args?.AbsolutePath);
        if (!required.has(key)) { requireComplete(found, required); return null; }
        if (batch.has(key) || Object.keys(call.args).some(name => !['AbsolutePath', 'toolAction', 'toolSummary'].includes(name))) fail('ambiguous or partial Google native file request');
        batch.add(key);
        const createdAt = Date.parse(row.created_at);
        if (!Number.isFinite(createdAt)) fail('Google native read request timestamp is missing');
        return { key, createdAt, requestEvent: event, requestStep: row.step_index };
      });
    } else if (row.type === 'GENERIC') {
      if (!pending.length) fail('Google native result has no matching tool request');
      const call = pending.shift();
      if (!call) continue;
      googleReadResult(row, call, required.get(call.key));
      found.set(call.key, { requestEvent: call.requestEvent, requestStep: call.requestStep, resultEvent: event, resultStep: row.step_index });
    } else fail('unsupported Google native event type');
  }
  if (pending.length) fail('Google native read request is missing its result');
  requireComplete(found, required);
  return found;
}

function verifyInstructionReadEvidence(options) {
  try {
    if (!['anthropic', 'openai', 'google'].includes(options.vendor) || typeof options.sessionId !== 'string' || !options.sessionId) fail('native vendor and session ID are required');
    // Google rows carry no session identity or cwd. The trusted collector must bind
    // the exact native conversation directory and bytes before constructing this value.
    if (options.vendor === 'google' && (typeof options.transcriptText !== 'string' || options.googleTranscriptBinding?.conversationId !== options.sessionId ||
      options.googleTranscriptBinding?.sha256 !== hash(options.transcriptText))) fail('Google full transcript requires a trusted collector conversation binding', 'INSTRUCTION_READ_UNSUPPORTED');
    const collected = collectRequiredInstructionFiles(options);
    const required = new Map(collected.files.map(file => [plainPath(file.path), file]));
    const nativeText = options.vendor === 'anthropic' ? options.captureText : options.transcriptText;
    const nativeRows = records(nativeText);
    const found = options.vendor === 'google' ? googleReads(nativeRows, required) :
      (options.vendor === 'anthropic' ? claudeReads : codexReads)(nativeRows, options.sessionId, required);
    return { protocol: INSTRUCTION_READ_PROTOCOL, status: 'PASS', vendor: options.vendor, sessionId: options.sessionId,
      requiredSetSha256: collected.requiredSetSha256, evidenceSha256: hash(nativeText),
      files: collected.files.map(file => ({ path: file.path, sha256: file.sha256, ...found.get(plainPath(file.path)) })) };
  } catch (error) {
    if (['INSTRUCTION_READ_FAIL', 'INSTRUCTION_READ_UNSUPPORTED'].includes(error.code)) throw error;
    fail('native instruction read validation failed: ' + error.message);
  }
}

module.exports = { INSTRUCTION_READ_PROTOCOL, codexReadCommand, codexReadTarget, collectRequiredInstructionFiles, verifyInstructionReadEvidence };
