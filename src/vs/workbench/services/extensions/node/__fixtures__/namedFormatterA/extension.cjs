"use strict";

/**
 * One of two formatters that sign the document, so a test sees which one ran. Each lives in its own folder: the
 * extension API overlay finds its owner by the extension root, and a shared root would give both one owner.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider("plaintext", {
            provideDocumentFormattingEdits: () => [vscode.TextEdit.insert(new vscode.Position(0, 0), "test.formatterA ")],
        }),
    );
};
