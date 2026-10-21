"use strict";

/**
 * Test fixture for ExtensionHost.test.ts / Indent.test.ts.
 * Sets a 2-space indent on the active editor through the public vscode API.
 */
exports.activate = function activate(_context) {
    const vscode = require("vscode");
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) return;
    editor.options = { tabSize: 2, insertSpaces: true };
};
