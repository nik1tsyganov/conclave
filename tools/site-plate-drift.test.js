// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readFileSync } = require('node:fs');

const SVG_PATH = path.resolve(__dirname, '..', 'site', 'conclave-core.svg');
const HTML_PATH = path.resolve(__dirname, '..', 'site', 'index.html');
const svg = readFileSync(SVG_PATH, 'utf8');
const html = readFileSync(HTML_PATH, 'utf8');
const files = { 'site/conclave-core.svg': svg, 'site/index.html': html };

// Role names are read out of the diagram's <text> elements, not hardcoded here.
const DIAGRAM_ROLES = [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)]
  .flatMap((m) => m[1].match(/\b[A-Z]{5,}\b/g) || []);
const NEVER_VOTES = /never votes/gi;
const countNeverVotes = (body) => (body.match(NEVER_VOTES) || []).length;
// '4.6' is left out on purpose: site/index.html already uses it for CSS sizes (4.6s, 4.6rem).
const MODEL_NAMES = ['grok', 'gpt-', 'claude-', 'gemini-', 'opus', 'sonnet', 'fable', 'astra', 'o3-'];

describe('site-plate-drift', () => {
  it('names the same four roles in the SVG diagram and the HTML route plate', () => {
    for (const role of ['PONENS', 'SCRUTATOR', 'ADVOCATUS', 'ARBITER']) {
      assert.ok(DIAGRAM_ROLES.includes(role),
        `site/conclave-core.svg lost the role ${role}; restore its <text> label or fix the token extraction above`);
      for (const [name, body] of Object.entries(files)) {
        assert.ok(new RegExp(role, 'i').test(body),
          `${name} is missing the role ${role}; keep this copy in step with the other one`);
      }
    }
  });

  it('keeps "never votes" in both copies, at least as often as the SVG uses it', () => {
    const svgCount = countNeverVotes(svg);
    for (const [name, body] of Object.entries(files)) {
      assert.ok(countNeverVotes(body) > 0,
        `${name} dropped the rule "never votes"; restore it from site/conclave-core.svg`);
      assert.ok(countNeverVotes(body) >= svgCount,
        `${name} says "never votes" ${countNeverVotes(body)} times, fewer than the SVG's ${svgCount}; a rule was dropped from one copy`);
    }
  });

  it('names roles and rules only, never a vendor model', () => {
    for (const [name, body] of Object.entries(files)) {
      for (const sub of MODEL_NAMES) {
        assert.ok(!body.toLowerCase().includes(sub),
          `${name} contains the model name "${sub}"; diagrams name roles and rules only, never vendor models`);
      }
    }
  });
});
