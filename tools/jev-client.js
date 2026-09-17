// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with section 7 terms; see LICENSE.
'use strict';

/**
 * TypeSafe System One (Jev) client. Dependency-free; uses global fetch.
 *
 * Key: process.env.TYPESAFE_API_KEY only (the lead sources
 * ~/.config/typesafe/env.sh). Never printed, logged, or written. Absent key
 * returns a structured NOT_RUN result; nothing here throws on the wire.
 *
 * Contract verified 2026-09-16 (typesafe-setup SKILL.md):
 *   POST https://api.typesafe.ai/v1/systemone, Authorization: Bearer <key>,
 *   body {state, model, questions}; answers per type:
 *   noul {noul}, choice {choice, probabilities, confidence},
 *   score {score, legend, probabilities, confidence}; usage {input_tokens, output_tokens}.
 *   429/529 retried with backoff, max 3 attempts.
 *
 * Every completed exchange appends one provenance row to provenancePath
 * (JSONL): ts, model, status, questionCount, requestSha256, responseSha256,
 * usage. The key is not part of the hashed body and never enters the row.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';
const RETRY_STATUS = new Set([429, 529]);
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 500;

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function notRun(reason) {
  return { ok: false, notRun: reason, answers: {}, usage: null };
}

async function systemOne({
  state,
  questions,
  model = DEFAULT_MODEL,
  provenancePath,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return notRun('TYPESAFE_API_KEY not set');
  if (!questions || Object.keys(questions).length === 0) return notRun('no questions');

  const body = JSON.stringify({ state, model, questions });
  let status;
  let text;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body,
      });
    } catch (err) {
      return notRun(`network: ${err.message}`);
    }
    status = response.status;
    text = await response.text();
    if (!RETRY_STATUS.has(status) || attempt === MAX_ATTEMPTS) break;
    await sleep(BACKOFF_MS * 2 ** (attempt - 1));
  }

  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }

  if (provenancePath) {
    const row = {
      ts: new Date().toISOString(),
      model: (parsed && parsed.model) || model,
      status,
      questionCount: Object.keys(questions).length,
      requestSha256: sha256(body),
      responseSha256: sha256(text),
      usage: (parsed && parsed.usage) || null,
    };
    fs.appendFileSync(provenancePath, `${JSON.stringify(row)}\n`, 'utf8');
  }

  if (status !== 200) return notRun(`HTTP ${status}: ${String(text).slice(0, 200)}`);
  if (!parsed || typeof parsed.answers !== 'object') return notRun('response had no answers object');
  return { ok: true, answers: parsed.answers, usage: parsed.usage || null, model: parsed.model || model };
}

module.exports = { systemOne, ENDPOINT, DEFAULT_MODEL, MAX_ATTEMPTS, sha256 };
