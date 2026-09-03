const fs = require('fs');
const path = require('path');
const { inspectBrief, pointerText } = require('./cli-pointer.js');

function buildArgs(briefOrPointer, model = 'gemini-3.1-pro-high', options = {}) {
    if (briefOrPointer.length > 30000) {
        throw new Error('Argument list too long');
    }
    if (briefOrPointer.length > 2000 && !briefOrPointer.startsWith('Read ')) {
        throw new Error('Magi CLI does not put brief bodies in argv; use buildLaunch({ briefPath }).');
    }
    
    const env = Object.assign({}, process.env);
    env.AGY_CLI_DISABLE_AUTO_UPDATE = 'true';
    delete env.GEMINI_API_KEY;
    delete env.GOOGLE_API_KEY;
    delete env.GOOGLE_GENAI_USE_VERTEXAI;
    delete env.GOOGLE_APPLICATION_CREDENTIALS;
    delete env.CLAUDECODE;

    const cwd = options.cwd || 'C:\\src\\magi';

    const args = [
        '--model', model,
        '--output-format', 'json',
        '--print-timeout', '20m'
    ];

    if (options.sandbox === true) {
        args.push('--sandbox');
    } else {
        args.push('--dangerously-skip-permissions');
    }

    args.push('--add-dir', 'C:\\Users\\YESSIR\\.claude\\skills');
    args.push('--add-dir', cwd);

    if (options.briefDir) {
        args.push('--add-dir', options.briefDir);
    }

    if (options.extraDirs && Array.isArray(options.extraDirs)) {
        for (const dir of options.extraDirs) {
            args.push('--add-dir', dir);
        }
    }

    args.push('-p', briefOrPointer);

    return {
        binary: 'C:\\Users\\YESSIR\\tools\\bin\\agy.exe',
        args,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
    };
}

function buildLaunch({ briefPath, model, cwd, extraDirs, sandbox }) {
    const info = inspectBrief(briefPath);
    const pText = pointerText(info);
    const briefDir = path.dirname(info.briefPath);
    
    return buildArgs(pText, model, { cwd, extraDirs, sandbox, briefDir });
}

function parseEnvelope(jsonStr) {
    try {
        const data = JSON.parse(jsonStr);
        if (data.status === 'SUCCESS' && data.response && data.conversation_id) {
            const result = {
                ok: true,
                conversation_id: data.conversation_id
            };
            if (data.usage !== undefined) {
                result.usage = data.usage;
            }
            return result;
        }
    } catch (e) {
        // parse error
    }
    return { ok: false };
}

function parseLogModel(logText, expectedModel) {
    const match = logText.match(/model="([^"]+)"/);
    if (!match) return false;
    if (expectedModel && match[1] !== expectedModel) {
        return false;
    }
    return match[1];
}

module.exports = {
    buildArgs,
    buildLaunch,
    parseEnvelope,
    parseLogModel
};
