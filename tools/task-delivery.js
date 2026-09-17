// MAGI, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

/**
 * Brief delivery for hostMode `cursor` native Tasks.
 *
 * The brief lives on disk; the Task `prompt` carries only the pointer sentence
 * from cli-pointer.js. Never paste the brief body into `prompt`.
 */

const { inspectBrief, pointerText } = require('./cli-pointer.js');
const fs = require('fs');
const path = require('path');

const MAX_PROMPT_CHARS = 2000;

function buildTaskPrompt(briefPath) {
    const info = inspectBrief(briefPath);
    if (info.bytes === 0) {
        throw new Error(`Brief file is empty: ${info.briefPath}`);
    }
    return {
        prompt: pointerText(info),
        briefPath: info.briefPath,
        bytes: info.bytes,
        sha256: info.sha256,
        firstLine: info.firstLine
    };
}

function assertTaskPrompt(prompt, briefBody, briefPath) {
    const resolvedPath = path.resolve(briefPath);
    if (!prompt.includes(resolvedPath)) {
        throw new Error('Launch payload missing pointer path');
    }

    if (prompt.length > MAX_PROMPT_CHARS) {
        throw new Error(`Task prompt is ${prompt.length} chars, max ${MAX_PROMPT_CHARS}: a pointer, not a warehouse`);
    }

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Pointer path missing: ${resolvedPath}`);
    }

    const realBody = fs.readFileSync(resolvedPath, 'utf8');
    if (realBody.length > 0 && prompt.includes(realBody)) {
        throw new Error('Launch payload contains brief body, expected only pointer');
    }
}

module.exports = {
    buildTaskPrompt,
    assertTaskPrompt
};
