"use strict";

/**
 * Test fixture: sets an 8-tab indent on the active editor.
 */
exports.activate = function activate(_context) {
    const vscode = require("vscode");
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) return;
    editor.options = { tabSize: 8, insertSpaces: false };
};
