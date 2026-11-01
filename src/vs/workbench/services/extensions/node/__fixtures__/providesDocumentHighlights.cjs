"use strict";

/**
 * Document highlight provider fixture for `let x = 1; x = 2; console.log(x); const y = { x: 3 };`: the two
 * reads of `x` and the write, but not the object key, which a textual search would light up too. A document
 * starting with `// DECLINE` gets `null`.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.languages.registerDocumentHighlightProvider(
            { language: "typescript" },
            {
                provideDocumentHighlights: function (document) {
                    if (document.getText().startsWith("// DECLINE")) return null;
                    const at = function (start, kind) {
                        return new vscode.DocumentHighlight(new vscode.Range(0, start, 0, start + 1), kind);
                    };
                    return [
                        at(4, vscode.DocumentHighlightKind.Read),
                        at(11, vscode.DocumentHighlightKind.Write),
                        at(30, vscode.DocumentHighlightKind.Read),
                    ];
                },
            },
        ),
    );
};
