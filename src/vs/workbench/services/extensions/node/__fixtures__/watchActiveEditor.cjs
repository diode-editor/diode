"use strict";

/**
 * Test fixture: subscribes to onDidChangeActiveTextEditor and
 * signals through tabSize that the event arrived and document.fileName
 * has the expected suffix:
 *   - fileName ends with ".ts"      → tabSize = 77
 *   - otherwise                     → tabSize = 1
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(function (editor) {
            if (editor == null) return;
            var tabSize = editor.document.fileName.endsWith(".ts") ? 77 : 1;
            editor.options = { tabSize: tabSize };
        }),
    );
};
