#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const AUTH_NEEDLES = ['not logged in', 'please run /login', 'auth required', 'authentication required'];

function argumentError(message) {
  const error = new Error(message);
  error.code = 'ARGUMENT_ERROR';
  return error;
}

function proofError(message) {
  const error = new Error(message);
  error.code = 'PROOF_FAIL';
  return error;
}

function read(file, field) {
  if (!file) return '';
  try { return fs.readFileSync(path.resolve(file), 'utf8'); }
  catch { throw argumentError(`${field} file does not exist: ${path.resolve(file)}`); }
}

function clean(text) {
  return String(text || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function parseCodex(logText, expectedModel) {
  const log = clean(logText);
  const headerMatch = log.match(/--------\s*([\s\S]*?)\s*--------/);
  const header = headerMatch ? headerMatch[1] : log.slice(0, 4000);
  const session = header.match(/^[ \t]*session id[ \t]*:[ \t]*(\S+)/im)?.[1];
  const model = header.match(/^[ \t]*model[ \t]*:[ \t]*(\S+)/im)?.[1] || null;
  const sandbox = header.match(/^[ \t]*sandbox[ \t]*:[ \t]*([^\s[]+)/im)?.[1] || null;
  const tokenMatches = [...log.matchAll(/tokens used(?:\s*:\s*|\s*\r?\n\s*)([0-9][0-9,]*)/gi)];
  const tokens = tokenMatches.length ? Number(tokenMatches.at(-1)[1].replaceAll(',', '')) : null;
  if (!session) throw proofError('Codex proof missing session id');
  if (!tokens) throw proofError('Codex proof missing tokens used');
  if (sandbox !== 'workspace-write' && sandbox !== 'read-only') throw proofError(`Codex proof missing/invalid sandbox: ${sandbox}`);
  if (expectedModel && model && model !== expectedModel) throw proofError(`Codex model mismatch: expected ${expectedModel}, observed ${model}`);
  return { vendor: 'openai', sessionId: session, vendorSideTokens: tokens, sandbox, modelObserved: model || expectedModel || null };
}

function parseGoogle(captureText, logText, expectedModel) {
  let envelope;
  try { envelope = JSON.parse(String(captureText).trim()); }
  catch { throw proofError('Google/agy capture is not valid JSON'); }
  if (envelope.status !== 'SUCCESS') throw proofError(`Google/agy status is ${envelope.status || 'missing'}, expected SUCCESS`);
  if (!envelope.conversation_id) throw proofError('Google/agy proof missing conversation_id');
  if (envelope.usage === undefined || envelope.usage === null) throw proofError('Google/agy proof missing usage');
  if (!envelope.response) throw proofError('Google/agy proof missing response');
  const modelObserved = clean(logText).match(/model="([^"]+)"/)?.[1] || null;
  if (!modelObserved) throw proofError('Google/agy proof missing observed model in per-run log');
  if (expectedModel && modelObserved !== expectedModel) {
    throw proofError(`Google/agy model mismatch: expected ${expectedModel}, observed ${modelObserved}`);
  }
  return {
    vendor: 'google',
    conversationId: envelope.conversation_id,
    usage: envelope.usage,
    modelObserved,
    responseBytes: Buffer.byteLength(String(envelope.response), 'utf8'),
  };
}

function parseClaude(captureText, expectedModel, expectedEffort, onTopic) {
  const capture = String(captureText || '');
  if (!capture.trim()) throw proofError('Claude capture is empty');
  const lower = capture.toLowerCase();
  const auth = AUTH_NEEDLES.find((needle) => lower.includes(needle));
  if (auth) throw proofError(`Claude capture contains auth failure language: ${auth}`);
  if (!expectedModel) throw proofError('Claude expected model is required');
  if (!expectedEffort) throw proofError('Claude expected effort is required');
  if (onTopic !== true) throw proofError('Claude topicality must be explicitly attested with --on-topic after arbiter inspection');
  return {
    vendor: 'anthropic',
    modelObserved: expectedModel,
    effortObserved: expectedEffort,
    onTopic: true,
    responseBytes: Buffer.byteLength(capture, 'utf8'),
    vendorSideTokens: null,
  };
}

function verifyProof(options) {
  const capture = read(options.capture, '--capture');
  const log = read(options.log, '--log');
  if (options.vendor === 'openai') return parseCodex(log, options.expectedModel);
  if (options.vendor === 'google') return parseGoogle(capture, log, options.expectedModel);
  if (options.vendor === 'anthropic') return parseClaude(capture, options.expectedModel, options.expectedEffort, options.onTopic);
  throw argumentError(`unsupported vendor: ${options.vendor}`);
}

function parseArgs(argv) {
  const out = { onTopic: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--on-topic') { out.onTopic = true; continue; }
    if (['--vendor', '--capture', '--log', '--expected-model', '--expected-effort'].includes(flag)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw argumentError(`${flag} requires a value`);
      out[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      continue;
    }
    if (flag === '--help' || flag === '-h') { out.help = true; continue; }
    throw argumentError(`unknown option: ${flag}`);
  }
  return out;
}

function usage() {
  return 'Usage: node tools/cli-proof.js --vendor <openai|google|anthropic> --capture <file> --log <file> --expected-model <slug> [--expected-effort <level>] [--on-topic]';
}

function main(argv = process.argv.slice(2), io = process) {
  try {
    const opts = parseArgs(argv);
    if (opts.help) { io.stdout.write(`${usage()}\n`); return 0; }
    if (!opts.vendor) throw argumentError('--vendor is required');
    if (!opts.capture) throw argumentError('--capture is required');
    if (!opts.log) throw argumentError('--log is required');
    const proof = verifyProof(opts);
    io.stdout.write(`${JSON.stringify({ ok: true, proof })}\n`);
    return 0;
  } catch (error) {
    const code = error.code || 'PROOF_FAIL';
    io.stderr.write(`${code}: ${error.message}\n`);
    return code === 'ARGUMENT_ERROR' ? 2 : 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { AUTH_NEEDLES, parseClaude, parseCodex, parseGoogle, verifyProof, main };
