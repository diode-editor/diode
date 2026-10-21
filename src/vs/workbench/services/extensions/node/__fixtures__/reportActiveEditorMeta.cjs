"use strict";

/**
 * Test fixture for ExtensionHost.ActiveEditor.test.ts.
 *
 * On active editor change checks:
 *   - document.languageId === "typescript" (arrived in meta over the wire);
 *   - stable identity: workspace.textDocuments contains EXACTLY the same
 *     object as activeTextEditor.document (compared by reference).
 * Signals success with tabSize=71, otherwise tabSize=13.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(function (editor) {
            if (editor == null) return;
            var doc = editor.document;
            var identityOk = vscode.workspace.textDocuments.indexOf(doc) >= 0;
            var ok = doc.languageId === "typescript" && identityOk;
            editor.options = { tabSize: ok ? 71 : 13 };
        }),
    );
};
