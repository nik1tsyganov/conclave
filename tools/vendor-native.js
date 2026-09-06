'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const GOOGLE_IDENTITY_LINE = /Print mode: starting.*model=|Print mode: conversation=|Created conversation /;
const CLAUDE_RESPONSE_PROTOCOL = 'claude-structured-response-v1';
const CLAUDE_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({ response: Object.freeze({ type: 'string', description: 'The final report, starting with the exact first line of the bound brief.' }) }),
  required: Object.freeze(['response']),
  additionalProperties: false,
});

function responseError(message) { return Object.assign(new Error(message), { code: 'PROOF_FAIL' }); }
function requireClaudeResponseProtocol(protocol) {
  if (protocol !== CLAUDE_RESPONSE_PROTOCOL) throw responseError('Claude structured response protocol is missing or unsupported');
}
function validateClaudeResponseLaunch(launch) {
  requireClaudeResponseProtocol(launch.responseProtocol);
  const args = launch.args || [];
  const schemaFlags = args.filter(arg => arg === '--json-schema' || String(arg).startsWith('--json-schema='));
  if (launch.vendor !== 'anthropic' || schemaFlags.length !== 1 || schemaFlags[0] !== '--json-schema' ||
      args[args.indexOf('--json-schema') + 1] !== JSON.stringify(CLAUDE_RESPONSE_SCHEMA)) {
    throw responseError('Claude launch does not bind the required structured response schema');
  }
}

function validateClaudeStructuredResponse(records) {
  if (!Array.isArray(records) || !records.length || records.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw responseError('Claude structured response has malformed native records');
  }
  if (records.some(row => row.is_error || row.subtype === 'error' || row.status === 'error' || row.error)) {
    throw responseError('Claude capture contains error result/status');
  }
  const terminals = records.filter(row => row.type === 'result');
  if (terminals.length !== 1) throw responseError('Claude structured response requires exactly one terminal result');
  const terminal = terminals[0];
  if (terminal.subtype !== 'success' || records.at(-1) !== terminal) throw responseError('Claude structured response requires a successful final terminal result');
  if (typeof terminal.session_id !== 'string' || !terminal.session_id.trim()) throw responseError('Claude structured response is missing terminal session identity');
  const nativeRows = records.filter(row => row.type === 'result' || row.type === 'assistant' || (row.type === 'system' && row.subtype === 'init'));
  if (nativeRows.some(row => Object.hasOwn(row, 'session_id') && row.session_id !== terminal.session_id)) throw responseError('Claude proof has inconsistent sessions');
  const payload = terminal.structured_output;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).length !== 1 || !Object.hasOwn(payload, 'response') ||
      typeof payload.response !== 'string' || !payload.response.trim()) {
    throw responseError('Claude structured_output must contain only a nonempty response string');
  }
  return payload.response;
}

function strictJsonRecords(capture) {
  capture = String(capture).replace(/^\uFEFF/, '');
  try { return [JSON.parse(capture)]; } catch {}
  try { return String(capture).split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line)); }
  catch { throw responseError('Claude capture is malformed structured data'); }
}

function jsonRecords(text) {
  text = String(text).replace(/^\uFEFF/, '');
  try { return [JSON.parse(text)]; } catch {}
  return String(text).split(/\r?\n/).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}
function finalResponse(vendor, capture, options = {}) {
  if (options.responseProtocol !== undefined) {
    requireClaudeResponseProtocol(options.responseProtocol);
    if (vendor !== 'anthropic') throw responseError('Claude structured response protocol cannot apply to another vendor');
    return validateClaudeStructuredResponse(strictJsonRecords(capture));
  }
  if (vendor === 'openai') return String(capture).trim();
  const records = jsonRecords(capture);
  if (vendor === 'google') return typeof records[0]?.response === 'string' ? records[0].response.trim() : '';
  const result = records.filter((item) => item.type === 'result').at(-1);
  return typeof result?.result === 'string' ? result.result.trim() : '';
}
function mergeGoogleIdentityLog(baseLog, raw) {
  const identityLines = text => String(text).split(/\r?\n/).filter(line => GOOGLE_IDENTITY_LINE.test(line));
  const base = identityLines(baseLog);
  const native = identityLines(raw);
  // A mirrored sequence is redundant. Keep differing sequences intact: removing
  // individual shared rows could hide a conflicting model/session association.
  if (native.length && native.length === base.length && native.every((line, index) => line === base[index])) return baseLog;
  return `${baseLog}\n${native.join('\n')}\n`;
}
function nativeLog(vendor, capture, baseLog, { home = os.homedir(), cwd, nativeLogPath } = {}) {
  if (vendor === 'openai') return baseLog;
  const records = jsonRecords(capture);
  if (vendor === 'google') {
    const id = records[0]?.conversation_id;
    if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('missing native Google conversation ID');
    if (nativeLogPath) {
      const raw = fs.readFileSync(nativeLogPath, 'utf8');
      if (!raw.includes(id)) throw new Error('Google dispatch log does not contain its native conversation ID');
      return mergeGoogleIdentityLog(baseLog, raw);
    }
    const root = path.join(home, '.gemini', 'antigravity-cli', 'log');
    for (const name of fs.readdirSync(root).filter((name) => /^cli-.*\.log$/.test(name)).sort().reverse()) {
      const raw = fs.readFileSync(path.join(root, name), 'utf8');
      if (!raw.includes(id)) continue;
      // Preserve native identity lines verbatim; do not copy unrelated prompts or account data.
      return mergeGoogleIdentityLog(baseLog, raw);
    }
    throw new Error('matching Google native per-run log missing');
  }
  const id = records.find((item) => item.session_id)?.session_id;
  if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('missing native Claude session ID');
  const root = path.join(home, '.claude', 'projects');
  const preferred = String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
  const dirs = [...new Set([preferred, ...fs.readdirSync(root)])];
  for (const directory of dirs) {
    const file = path.join(root, directory, `${id}.jsonl`);
    if (!fs.existsSync(file)) continue;
    const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => {
      try { const row = JSON.parse(line); return row.type === 'assistant' && row.sessionId === id; } catch { return false; }
    });
    if (rows.length) return `${baseLog}\n${rows.join('\n')}\n`;
  }
  throw new Error('matching Claude native session evidence missing');
}
module.exports = { CLAUDE_RESPONSE_PROTOCOL, CLAUDE_RESPONSE_SCHEMA, finalResponse, jsonRecords, nativeLog, requireClaudeResponseProtocol, validateClaudeResponseLaunch, validateClaudeStructuredResponse };
