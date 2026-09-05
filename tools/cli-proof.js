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

function tokenUsage(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw proofError(`${label} is malformed`);
  let total = 0;
  for (const key of keys) {
    const number = value[key];
    if (!Number.isSafeInteger(number) || number < 0) throw proofError(`${label} has invalid ${key}`);
    total += number;
  }
  if (!Number.isSafeInteger(total) || total <= 0) throw proofError(`${label} has invalid total`);
  return total;
}

function parseCodex(logText, expectedModel, options = {}) {
  const log = clean(logText);
  const preambleRegex = /^(?:(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s+WARN\s+\S+:[^\r\n]*|\s*)\r?\n)*/;
  const bannerRegex = /OpenAI Codex v[^\r\n]*\r?\n--------\s*?\r?\n([\s\S]*?)\r?\n\s*--------/g;

  const banners = [...log.matchAll(bannerRegex)];
  if (banners.length !== 1) throw proofError('Codex proof missing or ambiguous authentic banner header');

  const preambleMatch = log.match(preambleRegex);
  if (!preambleMatch || preambleMatch[0].length !== banners[0].index) {
    throw proofError('Codex proof banner must be in the preamble');
  }

  const header = banners[0][1];

  function getField(regex, name, required = true) {
    const matches = [...header.matchAll(regex)];
    if (matches.length > 1) throw proofError(`Codex proof has duplicate ${name}`);
    if (required && matches.length === 0) throw proofError(`Codex proof missing ${name}`);
    return matches.length ? matches[0][1] : null;
  }

  const session = getField(/^[ \t]*session id[ \t]*:[ \t]*(\S+)/gim, 'session id');
  const model = getField(/^[ \t]*model[ \t]*:[ \t]*(\S+)/gim, 'model');
  const sandbox = getField(/^[ \t]*sandbox[ \t]*:[ \t]*([^\s]+)/gim, 'sandbox');
  const effort = getField(/^[ \t]*reasoning effort[ \t]*:[ \t]*(\S+)/gim, 'reasoning effort');

  if (sandbox !== 'workspace-write' && sandbox !== 'read-only') throw proofError(`Codex proof missing/invalid sandbox: ${sandbox}`);
  if (options.expectedSandbox && sandbox !== options.expectedSandbox) throw proofError(`Codex sandbox mismatch: expected ${options.expectedSandbox}, observed ${sandbox}`);

  const VALID_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  if (!VALID_EFFORTS.includes(effort)) throw proofError(`Codex proof invalid effort: ${effort}`);
  if (options.expectedEffort && effort !== options.expectedEffort) throw proofError(`Codex effort mismatch: expected ${options.expectedEffort}, observed ${effort}`);

  if (expectedModel && model !== expectedModel) throw proofError(`Codex model mismatch: expected ${expectedModel}, observed ${model}`);

  const tokenMatches = [...log.matchAll(/(?:^|\r?\n)[ \t]*tokens used(?:\s*:\s*|\s*\r?\n\s*)([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\s*$/gi)];
  if (tokenMatches.length === 0) throw proofError('Codex proof missing tokens used');
  if (tokenMatches.length > 1) throw proofError('Codex proof ambiguous tokens used');

  const tokens = Number(tokenMatches[0][1].replaceAll(',', ''));
  if (!Number.isSafeInteger(tokens) || tokens <= 0) throw proofError('Codex proof has invalid tokens used');

  return {
    vendor: 'openai',
    sessionId: session,
    vendorSideTokens: tokens,
    sandbox,
    modelObserved: model,
    effortObserved: effort,
    modelRequested: expectedModel || null,
    effortRequested: options.expectedEffort || null,
    identityEvidence: 'exact'
  };
}

function parseGoogle(captureText, logText, expectedModel) {
  let envelope;
  try { envelope = JSON.parse(String(captureText).trim()); }
  catch { throw proofError('Google/agy capture is not valid JSON'); }
  if (envelope.status !== 'SUCCESS') throw proofError(`Google/agy status is ${envelope.status || 'missing'}, expected SUCCESS`);
  if (!envelope.conversation_id || typeof envelope.conversation_id !== 'string' || envelope.conversation_id.trim() === '') throw proofError('Google/agy proof missing conversation_id');
  if (!envelope.usage || typeof envelope.usage !== 'object' || Array.isArray(envelope.usage)) throw proofError('Google/agy proof missing or malformed usage');

  const { input_tokens, output_tokens, thinking_tokens, cache_read_tokens, total_tokens } = envelope.usage;
  if (typeof total_tokens !== 'number' || !Number.isSafeInteger(total_tokens) || total_tokens <= 0) throw proofError('Google/agy proof has invalid total_tokens');
  for (const k of ['input_tokens', 'output_tokens', 'thinking_tokens', 'cache_read_tokens']) {
    if (envelope.usage[k] !== undefined && (typeof envelope.usage[k] !== 'number' || !Number.isSafeInteger(envelope.usage[k]) || envelope.usage[k] < 0)) {
       throw proofError(`Google/agy proof has invalid ${k}`);
    }
  }

  if (!envelope.response || typeof envelope.response !== 'string' || envelope.response.trim() === '') throw proofError('Google/agy proof missing or whitespace response');

  const logStr = clean(logText);
  const records = [];
  const startRegex = /^(?:ERROR: logging before google\.Init: )?[IWEF]\d{4} \d{2}:\d{2}:\d{2}\.\d+\s+\d+ printmode\.go:\d+\] Print mode: starting \([^)]*model="([^"]+)"[^)]*conversationID="([^"]*)"\)/gm;
  const createRegex = /^(?:ERROR: logging before google\.Init: )?[IWEF]\d{4} \d{2}:\d{2}:\d{2}\.\d+\s+\d+ server\.go:\d+\] Created conversation ([\w-]+)/gm;
  const sessionRegex = /^(?:ERROR: logging before google\.Init: )?[IWEF]\d{4} \d{2}:\d{2}:\d{2}\.\d+\s+\d+ session\.go:\d+\] Print mode: conversation=([\w-]+), sending message/gm;

  let match;
  while ((match = startRegex.exec(logStr)) !== null) records.push({ type: 'start', index: match.index, model: match[1], id: match[2] });
  while ((match = createRegex.exec(logStr)) !== null) records.push({ type: 'create', index: match.index, id: match[1] });
  while ((match = sessionRegex.exec(logStr)) !== null) records.push({ type: 'session', index: match.index, id: match[1] });

  records.sort((a, b) => a.index - b.index);

  let boundModel = null;
  let matches = 0;

  let activeModel = null;
  let activeStartId = null;

  for (const r of records) {
    if (r.type === 'start') {
      activeModel = r.model;
      activeStartId = r.id;
    } else if (r.type === 'create') {
      if (activeModel) {
        if (activeStartId !== '' && activeStartId !== r.id) {
          activeModel = null;
        } else {
          activeStartId = r.id;
        }
      }
    } else if (r.type === 'session') {
      if (activeModel) {
        if (activeStartId !== '' && activeStartId !== r.id) {
          // conflicting session ID
        } else if (r.id === envelope.conversation_id) {
          boundModel = activeModel;
          matches++;
        }
      }
      activeModel = null;
    }
  }

  if (matches === 0) throw proofError('Google/agy proof missing observed model in per-run log for this conversation');
  if (matches > 1) throw proofError('Google/agy proof has ambiguous/conflicting logs for this conversation');
  const modelObserved = boundModel;

  if (expectedModel && modelObserved !== expectedModel) {
    throw proofError(`Google/agy model mismatch: expected ${expectedModel}, observed ${modelObserved}`);
  }

  return {
    vendor: 'google',
    conversationId: envelope.conversation_id,
    usage: envelope.usage,
    modelObserved,
    modelRequested: expectedModel || null,
    identityEvidence: 'exact',
    responseBytes: Buffer.byteLength(String(envelope.response), 'utf8')
  };
}

function parseClaude(captureText, expectedModel, expectedEffort, onTopic, options = {}) {
  if (options.identityPolicy) throw proofError('Claude identity policy overrides are not supported');
  const capture = String(captureText || '');
  if (!capture.trim()) throw proofError('Claude capture is empty');
  if (!expectedModel) throw proofError('Claude expected model is required');
  if (!expectedEffort) throw proofError('Claude expected effort is required');
  if (onTopic !== true) throw proofError('Claude topicality must be explicitly attested with --on-topic after arbiter inspection');

  const trimmed = capture.trim();
  let parsedEvents = [];
  let isStructured = false;

  if (trimmed.startsWith('{')) {
    try {
      parsedEvents = [JSON.parse(trimmed)];
      isStructured = true;
    } catch {
      try {
        parsedEvents = trimmed.split(/\r?\n/).filter(l => l.trim() !== '').map(l => JSON.parse(l));
        isStructured = true;
      } catch {
        throw proofError('Claude capture is malformed structured data');
      }
    }
  }

  if (isStructured) {
    let observedModels = new Set();
    const usageModels = new Set();
    let sessionIds = new Set();
    let usage = null;
    let vendorSideTokens = null;
    let hasActualResultText = false;
    let hasSuccessfulTerminalResult = false;

    for (const ev of parsedEvents) {
      if (ev.is_error || ev.subtype === 'error' || ev.status === 'error' || ev.error) {
         throw proofError('Claude capture contains error result/status');
      }

      if (ev.type === 'result' && ev.subtype === 'success') {
        if (hasSuccessfulTerminalResult) throw proofError('Claude proof has duplicate terminal results');
        hasSuccessfulTerminalResult = true;
        if (ev.result && typeof ev.result === 'string' && ev.result.trim() !== '') hasActualResultText = true;
        if (ev.session_id && typeof ev.session_id === 'string' && ev.session_id.trim() !== '') sessionIds.add(ev.session_id);

        usage = ev.usage;
        vendorSideTokens = tokenUsage(usage, ['input_tokens', 'output_tokens', ...['cache_read_input_tokens', 'cache_creation_input_tokens'].filter((key) => usage && key in usage)], 'Claude usage');

        if (ev.modelUsage !== undefined) {
          if (!ev.modelUsage || typeof ev.modelUsage !== 'object' || Array.isArray(ev.modelUsage)) throw proofError('Claude modelUsage is malformed');
          for (const [mod, usg] of Object.entries(ev.modelUsage)) {
            tokenUsage(usg, ['inputTokens', 'outputTokens', ...['cacheReadInputTokens', 'cacheCreationInputTokens'].filter((key) => usg && key in usg)], 'Claude modelUsage');
            usageModels.add(mod);
          }
        }
      } else if (ev.type === 'system' && ev.subtype === 'init') {
        if (ev.model && typeof ev.model === 'string') observedModels.add(ev.model);
        if (ev.session_id && typeof ev.session_id === 'string' && ev.session_id.trim() !== '') sessionIds.add(ev.session_id);
      } else if (ev.type === 'assistant') {
        if (ev.session_id && typeof ev.session_id === 'string' && ev.session_id.trim() !== '') sessionIds.add(ev.session_id);
        if (ev.message && typeof ev.message === 'object') {
          if (ev.message.model && typeof ev.message.model === 'string') observedModels.add(ev.message.model);
        }
      } else if (ev.type === 'user') {
        // Unknown/untyped JSON and type:user events must never supply model/session/usage/terminal success.
      } else {
        // Unknown type, ignore for metadata extraction
      }
    }

    if (!hasSuccessfulTerminalResult) throw proofError('Claude proof missing successful terminal result');
    if (!hasActualResultText) throw proofError('Claude proof missing actual result text');
    if (sessionIds.size === 0) throw proofError('Claude proof missing session identity');
    if (sessionIds.size > 1) throw proofError('Claude proof has inconsistent sessions');
    // modelUsage can include native utility calls (for example Haiku). It is an
    // identity fallback only for a terminal-only capture with exactly one model.
    if (observedModels.size === 0 && usageModels.size === 1) observedModels.add([...usageModels][0]);
    if (observedModels.size > 1 || (observedModels.size === 0 && usageModels.size > 1)) throw proofError('Claude proof has conflicting model evidence');
    if (observedModels.size === 1 && usageModels.size > 0 && !usageModels.has([...observedModels][0])) throw proofError('Claude terminal usage does not include the observed assistant model');

    if (!usage || usage.input_tokens === undefined) throw proofError('Claude proof missing valid numeric usage');

    const observedModel = observedModels.size === 1 ? [...observedModels][0] : null;
    if (!observedModel) throw proofError('Claude proof missing observed model identity');
    const targetModel = options.expectedObservedModel || expectedModel;
    if (observedModel !== targetModel) {
      throw proofError(`Claude model mismatch: expected ${targetModel}, observed ${observedModel}`);
    }

    let effortObserved = null;

    if (options.logText) {
      const transcriptLog = clean(options.logText);
      const tLines = transcriptLog.trim().split(/\r?\n/).filter(l => l.trim() !== '');
      const authSessionId = [...sessionIds][0];

      for (const l of tLines) {
        if (!l.trim().startsWith('{')) continue;
        let row;
        try { row = JSON.parse(l); } catch { continue; }

        if (row.type === 'assistant' && row.sessionId === authSessionId) {
           if (row.effort) {
              if (effortObserved && effortObserved !== row.effort) throw proofError('Claude proof has conflicting transcript effort');
              effortObserved = row.effort;
           }
           if (row.message && row.message.model) {
              if (observedModel && observedModel !== row.message.model) throw proofError('Claude proof has conflicting transcript model');
           }
        }
      }

      if (options.requireObservedEffort && !effortObserved) {
         throw proofError('Claude proof missing native observed effort');
      }
    } else if (options.requireObservedEffort) {
       throw proofError('Claude proof missing native observed effort (no transcript)');
    }

    if (effortObserved && effortObserved !== expectedEffort) {
       throw proofError(`Claude effort mismatch: expected ${expectedEffort}, observed ${effortObserved}`);
    }

    return {
      vendor: 'anthropic',
      modelRequested: expectedModel,
      effortRequested: expectedEffort,
      modelObserved: observedModel || null,
      effortObserved: effortObserved || null,
      identityEvidence: 'exact',
      sessionId: sessionIds.size === 1 ? [...sessionIds][0] : null,
      usage,
      vendorSideTokens,
      onTopic: true,
      responseBytes: Buffer.byteLength(capture, 'utf8'),
    };
  }

  // Only unstructured CLI diagnostics are scanned for authentication language.
  // Source files and review prose inside native events are task data, not status.
  const auth = AUTH_NEEDLES.find((needle) => capture.toLowerCase().includes(needle));
  if (auth) throw proofError(`Claude capture contains auth failure language: ${auth}`);
  throw proofError('Claude proof requires structured native evidence');
}

function verifyProof(options) {
  const capture = read(options.capture, '--capture');
  const log = read(options.log, '--log');

  if (options.identityPolicy) throw proofError('identity policy overrides are not supported');

  if (options.vendor === 'openai') return parseCodex(log, options.expectedModel, options);
  if (options.vendor === 'google') return parseGoogle(capture, log, options.expectedModel);
  if (options.vendor === 'anthropic') {
    const claudeOpts = { ...options, logText: log, requireObservedEffort: true };
    return parseClaude(capture, options.expectedModel, options.expectedEffort, options.onTopic, claudeOpts);
  }
  throw argumentError(`unsupported vendor: ${options.vendor}`);
}

function parseArgs(argv) {
  const out = { onTopic: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--on-topic') { out.onTopic = true; continue; }
    if (['--vendor', '--capture', '--log', '--expected-model', '--expected-effort', '--expected-sandbox', '--expected-observed-model'].includes(flag)) {
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
  return 'Usage: node tools/cli-proof.js --vendor <openai|google|anthropic> --capture <file> --log <file> --expected-model <slug> [--expected-effort <level>] [--on-topic] [--expected-sandbox <sandbox>] [--expected-observed-model <slug>]';
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
