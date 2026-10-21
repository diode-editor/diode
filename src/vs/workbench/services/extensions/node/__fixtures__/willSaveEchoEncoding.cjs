"use strict";

/**
 * will-save fixture: inserts `document.encoding` as the first line. Checks
 * that the core document's encoding reaches ExtHostTextDocument over the wire
 * (issue #106: .encoding comes from the snapshot, not a hardcoded "utf8").
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.workspace.onWillSaveTextDocument(function (event) {
            const edit = vscode.TextEdit.insert(new vscode.Position(0, 0), "encoding=" + event.document.encoding + "\n");
            event.waitUntil(Promise.resolve([edit]));
        }),
    );
};
