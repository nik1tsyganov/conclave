const fs = require('fs');

function buildArgs(briefText, model = 'gemini-3.1-pro-high', options = {}) {
    if (briefText.length > 30000) {
        throw new Error('Argument list too long');
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
        '--print-timeout', '20m',
        '--dangerously-skip-permissions',
        '--add-dir', 'C:\\Users\\YESSIR\\.claude\\skills',
        '--add-dir', cwd
    ];

    if (options.extraDirs && Array.isArray(options.extraDirs)) {
        for (const dir of options.extraDirs) {
            args.push('--add-dir', dir);
        }
    }

    args.push('-p', briefText);

    return {
        binary: 'C:\\Users\\YESSIR\\tools\\bin\\agy.exe',
        args,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
    };
}

function buildLaunch({ briefPath, model, extraDirs, cwd }) {
    const briefText = fs.readFileSync(briefPath, 'utf8');
    return buildArgs(briefText, model, { extraDirs, cwd });
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
