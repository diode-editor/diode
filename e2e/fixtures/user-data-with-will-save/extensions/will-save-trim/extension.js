"use strict";

/**
 * Герметичный гейт проводки: `extensionHostModule` обязан привязать `group.saveParticipant` к
 * `host.willSaveTextDocument`, иначе Ctrl+S пишет байты как есть.
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

exports.deactivate = function deactivate() {};
