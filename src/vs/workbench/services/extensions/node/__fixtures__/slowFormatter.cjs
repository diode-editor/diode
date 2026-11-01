"use strict";

/**
 * A formatter as slow as Biome on a large file (about 17 s on 60,000 lines), only shorter: it answers after 6 s.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider("plaintext", {
            provideDocumentFormattingEdits: () =>
                new Promise((resolve) => {
                    setTimeout(() => resolve([vscode.TextEdit.insert(new vscode.Position(0, 0), "formatted ")]), 6000);
                }),
        }),
    );
};
