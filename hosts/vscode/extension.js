// CONCLAVE, copyright (c) 2026 Nikita Tsyganov. GNU AGPL v3 with additional terms; see LICENSE and ADDITIONAL-TERMS.md.
'use strict';
/// The whole extension: tell VS Code how to start the CONCLAVE MCP server.
///
/// It contributes no command, no view and no tool of its own. The editor asks the server what
/// it can do, so a tool added or changed in the runtime appears here with nothing rebuilt.

const vscode = require('vscode');
const { resolveServer } = require('./resolve.js');

function activate(context) {
  const changed = new vscode.EventEmitter();
  context.subscriptions.push(changed);

  // A settings change moves the server, so say so rather than waiting for a reload.
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('conclave')) changed.fire();
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => changed.fire()));

  context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider('conclave.servers', {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions() {
      const settings = vscode.workspace.getConfiguration('conclave');
      let server;
      try {
        server = resolveServer({
          settingPath: settings.get('serverPath'),
          workspaceFolders: (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath),
          exists: (file) => require('node:fs').existsSync(file),
          rulesOnly: settings.get('rulesOnly') === true,
        });
      } catch (error) {
        // A configured path that is not there is the user's mistake to see, not a silent
        // fall back to a different server than the one they named.
        vscode.window.showErrorMessage(error.message);
        return [];
      }
      return [new vscode.McpStdioServerDefinition(server.label, server.command, server.args)];
    },
    resolveMcpServerDefinition(server) { return server; },
  }));
}

function deactivate() {}

module.exports = { activate, deactivate };
