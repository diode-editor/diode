"use strict";

/**
 * The occurrences of `x` a language server would give: `x = ` is a write, a bare `x` a read, and `x:` an object
 * key, another symbol, is left out. Any other word gets `null`, which hands it to the textual search.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.languages.registerDocumentHighlightProvider(
            { language: "plaintext" },
            {
                provideDocumentHighlights(document, position) {
                    const word = document.getWordRangeAtPosition(position);
                    if (word === undefined || document.getText(word) !== "x") return null;
                    const text = document.getText();
                    const highlights = [];
                    const re = /\bx\b(?!:)/g;
                    let match;
                    while ((match = re.exec(text)) !== null) {
                        const range = new vscode.Range(
                            document.positionAt(match.index),
                            document.positionAt(match.index + 1),
                        );
                        const isWrite = text.startsWith(" = ", match.index + 1);
                        highlights.push(
                            new vscode.DocumentHighlight(
                                range,
                                isWrite ? vscode.DocumentHighlightKind.Write : vscode.DocumentHighlightKind.Read,
                            ),
                        );
                    }
                    return highlights;
                },
            },
        ),
    );
};

exports.deactivate = function deactivate() {};
