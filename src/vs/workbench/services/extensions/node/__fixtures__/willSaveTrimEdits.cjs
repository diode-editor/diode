"use strict";

/**
 * will-save fixture: subscribes to onWillSaveTextDocument and returns edits via waitUntil:
 * trims trailing whitespace on every line and adds a final newline
 * if it is missing. Checks that TextEdit[] from a participant is really applied
 * to the buffer and the transformed bytes are written to disk.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.workspace.onWillSaveTextDocument(function (event) {
            const doc = event.document;
            const edits = [];
            for (let i = 0; i < doc.lineCount; i++) {
                const text = doc.lineAt(i).text;
                const trimmed = text.replace(/[ \t]+$/, "");
                if (trimmed.length !== text.length) {
                    edits.push(vscode.TextEdit.delete(new vscode.Range(i, trimmed.length, i, text.length)));
                }
            }
            const last = doc.lineCount - 1;
            const lastText = doc.lineAt(last).text;
            if (lastText.length > 0) {
                edits.push(vscode.TextEdit.insert(new vscode.Position(last, lastText.length), "\n"));
            }
            event.waitUntil(Promise.resolve(edits));
        }),
    );
};
