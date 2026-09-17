// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildTaskPrompt, assertTaskPrompt } = require('./task-delivery.js');

test('buildTaskPrompt throws on a missing file', () => {
    assert.throws(() => {
        buildTaskPrompt('./temp-task-delivery-does-not-exist.md');
    }, /ENOENT/);
});

test('buildTaskPrompt throws on an empty file', () => {
    const tempPath = './temp-task-delivery-empty.md';
    fs.writeFileSync(tempPath, '');
    try {
        assert.throws(() => {
            buildTaskPrompt(tempPath);
        }, /empty/);
    } finally {
        fs.unlinkSync(tempPath);
    }
});

test('assertTaskPrompt throws when a 40-char unique leak occurs', () => {
    const briefPath = './temp-task-delivery-brief-40.md';
    const body = '40-char-unique-leak-marker-xxxxxxxxxxxxx';
    assert.strictEqual(body.length, 40);
    fs.writeFileSync(briefPath, body);
    try {
        assert.throws(() => {
            assertTaskPrompt(`Read ${path.resolve(briefPath)} ${body}`, body, briefPath);
        }, /contains brief body/);
    } finally {
        fs.unlinkSync(briefPath);
    }
});

test('assertTaskPrompt throws when a 699-char leak occurs with briefBody: stale', () => {
    const briefPath = './temp-task-delivery-brief-699.md';
    const body = '699-char-leak-marker-'.padEnd(699, 'y');
    assert.strictEqual(body.length, 699);
    fs.writeFileSync(briefPath, body);
    try {
        assert.throws(() => {
            assertTaskPrompt(`Read ${path.resolve(briefPath)} ${body}`, 'stale', briefPath);
        }, /contains brief body/);
    } finally {
        fs.unlinkSync(briefPath);
    }
});

test('assertTaskPrompt throws when the prompt misses the brief path', () => {
    const body = 'b'.repeat(100);
    assert.throws(() => {
        assertTaskPrompt('a pointer with no path in it', body, './temp-task-delivery-brief.md');
    }, /missing pointer path/);
});

test('assertTaskPrompt throws when the prompt exceeds 2000 chars', () => {
    const briefPath = './temp-task-delivery-brief.md';
    const body = 'b'.repeat(100);
    const prompt = `Read ${path.resolve(briefPath)} ` + 'y'.repeat(2100);
    assert.throws(() => {
        assertTaskPrompt(prompt, body, briefPath);
    }, /2000/);
});

test('assertTaskPrompt throws when the brief path is missing from filesystem', () => {
    const briefPath = './temp-task-delivery-missing.md';
    const body = 'b'.repeat(100);
    const prompt = `Read ${path.resolve(briefPath)} `;
    assert.throws(() => {
        assertTaskPrompt(prompt, body, briefPath);
    }, /Pointer path missing/);
});

test('buildTaskPrompt yields a pointer prompt that passes assertTaskPrompt', () => {
    const tempPath = './temp-task-delivery-success.md';
    const body = 'FIRST-LINE-MARKER\n' + 'z'.repeat(4982);
    fs.writeFileSync(tempPath, body);
    try {
        const built = buildTaskPrompt(tempPath);
        assert.strictEqual(built.briefPath, path.resolve(tempPath));
        assert.strictEqual(built.bytes, 5000);
        assert.strictEqual(built.sha256.length, 64);
        assert.strictEqual(built.firstLine, 'FIRST-LINE-MARKER');
        assert.ok(built.prompt.startsWith('Read '));
        assert.ok(built.prompt.includes(path.resolve(tempPath)));
        assert.ok(built.prompt.includes('Bytes: 5000'));
        assert.ok(built.prompt.includes(built.sha256));
        assert.ok(!built.prompt.includes(body));
        assert.ok(built.prompt.length <= 2000);
        assert.doesNotThrow(() => {
            assertTaskPrompt(built.prompt, body, tempPath);
        });
    } finally {
        fs.unlinkSync(tempPath);
    }
});
