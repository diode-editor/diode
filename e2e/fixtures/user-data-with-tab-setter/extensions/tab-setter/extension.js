"use strict";

/** tabSize=7 уникален — по раскладке табов видно, что его поставило расширение. */
exports.activate = function activate(_context) {
    const vscode = require("vscode");
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) return;
    editor.options = { tabSize: 7, insertSpaces: false };
};

exports.deactivate = function deactivate() {};
