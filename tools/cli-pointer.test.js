const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { inspectBrief, pointerText, writePointerFile, assertPointerLaunch } = require('./cli-pointer.js');

test('inspectBrief', () => {
    const tempPath = './temp-pointer-test.md';
    fs.writeFileSync(tempPath, 'first line\nsecond line');
    try {
        const info = inspectBrief(tempPath);
        assert.strictEqual(info.briefPath, path.resolve(tempPath));
        assert.strictEqual(info.firstLine, 'first line');
        assert.ok(info.bytes > 0);
        assert.ok(info.sha256.length === 64);
    } finally {
        fs.unlinkSync(tempPath);
    }
});

test('pointerText', () => {
    const text = pointerText({
        briefPath: 'C:\\path\\to\\brief.md',
        bytes: 123,
        sha256: 'abc'
    });
    assert.strictEqual(text, 'Read C:\\path\\to\\brief.md in full. Bytes: 123. SHA-256: abc. Follow it. Repeat its first line verbatim before anything else.\n');
});

test('writePointerFile', () => {
    const tempPath = './temp-pointer-test2.md';
    const destPath = './temp-pointer-dest.md';
    fs.writeFileSync(tempPath, 'body');
    try {
        const out = writePointerFile(tempPath, destPath);
        assert.strictEqual(out, path.resolve(destPath));
        const content = fs.readFileSync(destPath, 'utf8');
        assert.ok(content.startsWith('Read '));
        assert.ok(content.includes(path.resolve(tempPath)));
    } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    }
});

test('assertPointerLaunch', () => {
    const briefPath = './brief.md';
    const resolvedPath = path.resolve(briefPath);
    const body = 'x'.repeat(100);

    assert.doesNotThrow(() => {
        assertPointerLaunch(`pointer to ${resolvedPath}`, body, briefPath);
    });

    assert.throws(() => {
        assertPointerLaunch(`pointer with body ${body} and ${resolvedPath}`, body, briefPath);
    }, /contains brief body/);

    assert.throws(() => {
        assertPointerLaunch(`pointer missing path`, body, briefPath);
    }, /missing pointer path/);
});
