"use strict";

/**
 * Test fixture for ExtensionHost.Configuration.test.ts.
 *
 * Reads configuration from two layers via vscode.workspace.getConfiguration and
 * signals the result through the active editor's editor.options:
 *   - tabSize      ← getConfiguration("editor").get("tabSize")  (user snapshot)
 *   - insertSpaces ← getConfiguration("editorconfig").get("spaces")  (contributed default)
 */
exports.activate = function activate(_context) {
    const vscode = require("vscode");
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) return;
    const tabSize = vscode.workspace.getConfiguration("editor").get("tabSize");
    const spaces = vscode.workspace.getConfiguration("editorconfig").get("spaces");
    editor.options = { tabSize: tabSize, insertSpaces: spaces };
};
