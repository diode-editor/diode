"use strict";

/** tabSize=7 is unique — the tab layout shows that the extension set it. */
exports.activate = function activate(_context) {
    const vscode = require("vscode");
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) return;
    editor.options = { tabSize: 7, insertSpaces: false };
};

exports.deactivate = function deactivate() {};
