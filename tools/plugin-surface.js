'use strict';

/**
 * Cursor plugin.json surface path fields (skills/rules/agents/commands).
 *
 * Conclave declares these fields so discovery does not depend on default
 * folder scanning. Magi must declare them too, with values that match
 * files actually shipped:
 *   - source repo: skills/rules live under .cursor/, agents/commands at root
 *   - installed magi: installer copies those trees to skills/rules/agents/commands
 *   - installed magi-cursor-cli: no agents/ directory (and must not declare one)
 */

const SOURCE_SURFACE = Object.freeze({
  skills: './.cursor/skills/',
  rules: './.cursor/rules/',
  agents: './agents/',
  commands: './commands/',
});

const INSTALLED_MAGI_SURFACE = Object.freeze({
  skills: './skills/',
  rules: './rules/',
  agents: './agents/',
  commands: './commands/',
});

const INSTALLED_MAGI_CLI_SURFACE = Object.freeze({
  skills: './skills/',
  rules: './rules/',
  commands: './commands/',
});

const SURFACE_FIELD_NAMES = Object.freeze(['skills', 'rules', 'agents', 'commands']);

function normalizeSurfacePath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function isUnsafeSurfacePath(value) {
  if (typeof value !== 'string' || value.length === 0) return true;
  if (pathIsAbsolute(value)) return true;
  const parts = normalizeSurfacePath(value).split('/');
  return parts.some((part) => part === '..');
}

function pathIsAbsolute(value) {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

function missingSurfaceFields(manifest, requiredFields) {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest'];
  }
  const missing = [];
  for (const [field, expected] of Object.entries(requiredFields)) {
    const actual = manifest[field];
    if (typeof actual !== 'string' || actual.length === 0) {
      missing.push(field);
      continue;
    }
    if (isUnsafeSurfacePath(actual)) {
      missing.push(`${field} (unsafe path)`);
      continue;
    }
    if (normalizeSurfacePath(actual) !== normalizeSurfacePath(expected)) {
      missing.push(`${field} (expected ${expected})`);
    }
  }
  return missing;
}

function unexpectedSurfaceFields(manifest, requiredFields) {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest'];
  }
  return SURFACE_FIELD_NAMES.filter((field) => Object.hasOwn(requiredFields, field) === false && Object.hasOwn(manifest, field));
}

function checkManifestSurface(manifest, requiredFields) {
  const missing = missingSurfaceFields(manifest, requiredFields);
  if (missing.length) {
    return { ok: false, error: `plugin.json missing surface path field: ${missing.join(', ')}` };
  }
  const unexpected = unexpectedSurfaceFields(manifest, requiredFields);
  if (unexpected.length) {
    return { ok: false, error: `plugin.json unexpected surface path field: ${unexpected.join(', ')}` };
  }
  return { ok: true, error: null };
}

function applySurfaceFields(manifest, requiredFields) {
  return { ...manifest, ...requiredFields };
}

module.exports = {
  SOURCE_SURFACE,
  INSTALLED_MAGI_SURFACE,
  INSTALLED_MAGI_CLI_SURFACE,
  SURFACE_FIELD_NAMES,
  normalizeSurfacePath,
  isUnsafeSurfacePath,
  missingSurfaceFields,
  unexpectedSurfaceFields,
  checkManifestSurface,
  applySurfaceFields,
};
