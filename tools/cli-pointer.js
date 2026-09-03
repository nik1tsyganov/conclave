const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function inspectBrief(briefPath) {
    const resolvedPath = path.resolve(briefPath);
    const buffer = fs.readFileSync(resolvedPath);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const contentStr = buffer.toString('utf8');
    const firstLineMatch = contentStr.match(/^[^\n]*/);
    const firstLine = firstLineMatch ? firstLineMatch[0] : '';

    return {
        briefPath: resolvedPath,
        bytes: buffer.length,
        sha256: sha256.toLowerCase(),
        firstLine
    };
}

function pointerText(info) {
    return `Read ${info.briefPath} in full. Bytes: ${info.bytes}. SHA-256: ${info.sha256}. Follow it. Repeat its first line verbatim before anything else.\n`;
}

function writePointerFile(briefPath, destPath) {
    const info = inspectBrief(briefPath);
    const text = pointerText(info);
    const outPath = destPath ? path.resolve(destPath) : path.resolve(briefPath + '.pointer.md');
    fs.writeFileSync(outPath, text, 'utf8');
    return outPath;
}

function assertPointerLaunch(haystack, briefBody, briefPath) {
    if (briefBody.length > 0 && haystack.includes(briefBody)) {
        throw new Error('Launch payload contains brief body, expected only pointer');
    }
    const resolvedPath = path.resolve(briefPath);
    if (!haystack.includes(resolvedPath)) {
        throw new Error('Launch payload missing pointer path');
    }
}

module.exports = {
    inspectBrief,
    pointerText,
    writePointerFile,
    assertPointerLaunch
};
