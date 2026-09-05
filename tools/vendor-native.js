'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const GOOGLE_IDENTITY_LINE = /Print mode: starting.*model=|Print mode: conversation=|Created conversation /;

function jsonRecords(text) {
  try { return [JSON.parse(text)]; } catch {}
  return String(text).split(/\r?\n/).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}
function finalResponse(vendor, capture) {
  if (vendor === 'openai') return String(capture).trim();
  const records = jsonRecords(capture);
  if (vendor === 'google') return typeof records[0]?.response === 'string' ? records[0].response.trim() : '';
  const result = records.filter((item) => item.type === 'result').at(-1);
  return typeof result?.result === 'string' ? result.result.trim() : '';
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
      return `${baseLog}\n${raw.split(/\r?\n/).filter((line) => GOOGLE_IDENTITY_LINE.test(line)).join('\n')}\n`;
    }
    const root = path.join(home, '.gemini', 'antigravity-cli', 'log');
    for (const name of fs.readdirSync(root).filter((name) => /^cli-.*\.log$/.test(name)).sort().reverse()) {
      const raw = fs.readFileSync(path.join(root, name), 'utf8');
      if (!raw.includes(id)) continue;
      // Preserve native identity lines verbatim; do not copy unrelated prompts or account data.
      return `${baseLog}\n${raw.split(/\r?\n/).filter((line) => GOOGLE_IDENTITY_LINE.test(line)).join('\n')}\n`;
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
module.exports = { finalResponse, jsonRecords, nativeLog };
