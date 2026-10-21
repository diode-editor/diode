"use strict";

/**
 * will-save fixture: returns a single edit that switches EOL to CRLF via
 * TextEdit.setEndOfLine. Checks that the setEndOfLine wire edit reaches the core
 * (doc.setEol from WP5) and the bytes on disk contain \r\n.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.workspace.onWillSaveTextDocument(function (event) {
            event.waitUntil(Promise.resolve([vscode.TextEdit.setEndOfLine(vscode.EndOfLine.CRLF)]));
        }),
    );
};
