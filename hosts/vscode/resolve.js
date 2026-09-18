// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
/// Where the server is, and nothing else.
///
/// The extension holds no rule, no tool name and no schema: it says how to start the server
/// and the editor reads the rest over the protocol. That is the whole point of shipping this
/// as MCP — a change to the runtime reaches every editor without an edit here.
///
/// Kept apart from extension.js so it can be tested without an editor to host it.

const path = require('node:path');

/// Resolution order, first hit wins:
///
/// 1. `conclave.serverPath`, when someone has said where their checkout is.
/// 2. A checkout in the workspace: `<folder>/mcp/server.js`, so working ON the runtime uses
///    the copy being edited rather than a published one that is a version behind.
/// 3. The published package, through npx. No install step and no path to keep current.
///
/// `rulesOnly` serves the six tools that answer from JSON and refuses the four that drive a
/// run. An editor that wants to convene a panel needs the full set; one that only reads
/// verdicts should ask for less.
function resolveServer({ settingPath, workspaceFolders = [], exists, rulesOnly = false, nodePath = 'node' } = {}) {
  if (typeof exists !== 'function') throw new TypeError('exists(path) is required');
  const args = rulesOnly ? ['--rules-only'] : [];

  if (settingPath && String(settingPath).trim()) {
    const file = path.isAbsolute(settingPath) ? settingPath : path.resolve(settingPath);
    if (!exists(file)) {
      // Named and not there stops, rather than quietly falling through to a different
      // server: someone who set this meant that copy.
      const error = new Error(`conclave.serverPath points at ${file}, which is not there`);
      error.code = 'CONCLAVE_SERVER_PATH_MISSING';
      throw error;
    }
    return { kind: 'setting', command: nodePath, args: [file, ...args], label: 'CONCLAVE (configured)' };
  }

  for (const folder of workspaceFolders) {
    const file = path.join(folder, 'mcp', 'server.js');
    if (exists(file)) {
      return { kind: 'workspace', command: nodePath, args: [file, ...args], label: 'CONCLAVE (this checkout)' };
    }
  }

  return { kind: 'published', command: 'npx', args: ['-y', 'conclave-mcp', ...args], label: 'CONCLAVE' };
}

module.exports = { resolveServer };
