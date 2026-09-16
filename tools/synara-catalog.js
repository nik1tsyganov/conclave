#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readJsonFile } = require('./json-file.js');
const { writeJson } = require('./dispatch-evidence.js');

const VENDOR_MAP = Object.freeze({
  openai: { provider: 'codex', optionKey: 'reasoningEffort' },
  anthropic: { provider: 'claudeAgent', optionKey: 'effort' },
  google: { provider: 'antigravity', optionKey: 'reasoningEffort' },
});

const MODEL_ALIASES = Object.freeze({
  openai: Object.freeze({}),
  anthropic: Object.freeze({
    opus: ['opus', 'opus[1m]', 'claude-opus-5'],
    fable: ['fable', 'claude-fable-5', 'claude-fable-5-1', 'claude-fable-5[1m]'],
  }),
  google: Object.freeze({
    'gemini-3.1-pro-high': ['gemini-3.1-pro-high', 'gemini-3.1-pro', 'Gemini 3.1 Pro'],
    'gemini-3.8-flash-high': ['gemini-3.8-flash-high', 'Gemini 3.8 Flash'],
    'gemini-3.8-flash-medium': ['gemini-3.8-flash-medium', 'Gemini 3.8 Flash'],
    'gemini-3.8-flash-low': ['gemini-3.8-flash-low', 'Gemini 3.8 Flash'],
  }),
});

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value))];
}

function aliases(vendor, model) {
  return unique([model, ...(MODEL_ALIASES[vendor]?.[model] || [])]);
}

function optionKeyFor(construction, provider, fallback) {
  const options = construction?.[provider]?.providerOptions || {};
  if (options.reasoningEffort) return 'reasoningEffort';
  if (options.effort) return 'effort';
  return fallback;
}

function constructionEfforts(construction, provider, slug, optionKey) {
  const byModel = construction?.[provider]?.optionsByModel?.[slug]?.[optionKey];
  const allowed = byModel?.allowedValues;
  return Array.isArray(allowed) ? allowed.filter((value) => typeof value === 'string') : [];
}

function modelEfforts(model, construction, provider, optionKey) {
  const supported = (model.supportedReasoningEfforts || []).map((entry) => (
    typeof entry === 'string' ? entry : entry?.value
  ));
  return unique([...supported, ...constructionEfforts(construction, provider, model.slug, optionKey)]);
}

function normalizeCapabilities(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('capabilities must be a JSON object');
  const providers = Object.fromEntries((raw.providers || []).filter((row) => row && row.provider).map((row) => [row.provider, row]));
  const construction = raw.targetConstruction || {};
  const vendorMap = {};
  const models = {};
  for (const [vendor, defaults] of Object.entries(VENDOR_MAP)) {
    const optionKey = optionKeyFor(construction, defaults.provider, defaults.optionKey);
    vendorMap[vendor] = { provider: defaults.provider, optionKey };
    models[vendor] = {};
    for (const model of providers[defaults.provider]?.models || []) {
      if (!model?.slug) continue;
      models[vendor][model.slug] = {
        slugs: unique([model.slug, model.name]),
        efforts: modelEfforts(model, construction, defaults.provider, optionKey),
      };
    }
  }
  return { schemaVersion: 1, capturedAt: raw.capturedAt || new Date().toISOString(), vendorMap, models };
}

function loadCatalog(file) {
  const data = readJsonFile(path.resolve(file));
  if (data.schemaVersion === 1 && data.vendorMap && data.models) return data;
  return normalizeCapabilities(data);
}

function matchCatalogModel(catalog, vendor, model) {
  const wanted = new Set(aliases(vendor, model).map((slug) => slug.toLowerCase()));
  return Object.values(catalog.models?.[vendor] || {}).find((entry) => (
    (entry.slugs || []).some((slug) => wanted.has(String(slug).toLowerCase()))
  )) || null;
}

function catalogListsRoute(catalog, route) {
  const match = matchCatalogModel(catalog, route.vendor, route.model);
  if (!match) return false;
  if (route.vendor === 'google' && String(route.effort || '').startsWith('fused-')) return true;
  if (!Array.isArray(match.efforts) || match.efforts.length === 0) return true;
  return match.efforts.includes(route.effort);
}

function narrowMatrix(matrix, catalog) {
  const copy = structuredClone(matrix);
  const dropped = [];
  for (const [className, cls] of Object.entries(copy.classes || {})) {
    for (const [role, routes] of Object.entries(cls || {})) {
      if (!Array.isArray(routes)) continue;
      cls[role] = routes.filter((route) => {
        const keep = catalogListsRoute(catalog, route);
        if (!keep) dropped.push({ class: className, role, vendor: route.vendor, model: route.model, effort: route.effort });
        return keep;
      });
    }
  }
  return { matrix: copy, dropped };
}

function launchOverlay(catalog, vendor, model, effort) {
  const map = catalog.vendorMap?.[vendor];
  if (!map) return {};
  const match = matchCatalogModel(catalog, vendor, model);
  return {
    synaraProvider: map.provider,
    synaraOptionKey: map.optionKey,
    magiEffort: effort,
    synaraModelSlugs: match?.slugs || [],
  };
}

function remapFableFallback(probe, catalog) {
  const requested = probe?.requestedModel || probe?.model;
  const observed = probe?.observedModel;
  const effort = probe?.effort || 'high';
  const fableRequest = requested === 'fable' || String(requested || '').toLowerCase().includes('fable');
  if (!fableRequest) return { remap: null, reason: 'not a fable request' };
  if (!observed || observed === requested || String(observed).toLowerCase().includes('fable')) {
    return { remap: null, reason: 'probe identity does not conflict' };
  }
  const opusRoute = { vendor: 'anthropic', model: 'opus', effort };
  if (!catalogListsRoute(catalog, opusRoute)) return { remap: null, reason: 'opus not listed in catalog' };
  return {
    remap: opusRoute,
    from: { vendor: 'anthropic', model: 'fable', effort },
    observed,
    reason: 'fable probe observed a different model; remap and probe opus. Do not accept the mismatched identity.',
  };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith('--')) throw new Error(`unknown argument: ${flag}`);
    const key = flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (['import', 'out', 'catalog', 'remapProbe', 'narrowMatrix'].includes(key)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
      if (Object.hasOwn(opts, key)) throw new Error(`duplicate option: ${flag}`);
      opts[key] = value;
      continue;
    }
    throw new Error(`unknown option: ${flag}`);
  }
  return opts;
}

function main(argv = process.argv.slice(2)) {
  try {
    const opts = parseArgs(argv);
    if (opts.import && opts.out && !opts.remapProbe && !opts.narrowMatrix) {
      const catalog = loadCatalog(opts.import);
      writeJson(path.resolve(opts.out), catalog);
      process.stdout.write(`${JSON.stringify({ ok: true, out: path.resolve(opts.out), models: Object.fromEntries(Object.entries(catalog.models).map(([vendor, rows]) => [vendor, Object.keys(rows)])) })}\n`);
      return 0;
    }
    if (opts.remapProbe && opts.catalog) {
      const result = remapFableFallback(readJsonFile(path.resolve(opts.remapProbe)), loadCatalog(opts.catalog));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return 0;
    }
    if (opts.narrowMatrix && opts.catalog) {
      const matrix = readJsonFile(path.resolve(opts.narrowMatrix));
      const result = narrowMatrix(matrix, loadCatalog(opts.catalog));
      if (opts.out) writeJson(path.resolve(opts.out), result.matrix);
      process.stdout.write(`${JSON.stringify({ ok: true, dropped: result.dropped, out: opts.out ? path.resolve(opts.out) : null })}\n`);
      return 0;
    }
    throw new Error('Usage: synara-catalog --import <capabilities.json> --out <catalog.json> | --remap-probe <probe.json> --catalog <catalog.json> | --narrow-matrix <matrix.json> --catalog <catalog.json> [--out <matrix.json>]');
  } catch (error) {
    process.stderr.write(`SYNARA_CATALOG_FAIL: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = {
  MODEL_ALIASES,
  VENDOR_MAP,
  catalogListsRoute,
  launchOverlay,
  loadCatalog,
  main,
  narrowMatrix,
  normalizeCapabilities,
  remapFableFallback,
};
