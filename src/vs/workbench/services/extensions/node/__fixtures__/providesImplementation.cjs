"use strict";

const path = require("node:path");

/**
 * Implementation provider fixture: for typescript documents returns targets in the `impl.ts` file
 * next to the requested document. The result shape depends on the cursor line:
 *   - line 0 → two `vscode.Location`s (impl.ts:1:4–1:8 and impl.ts:4:4–4:8);
 *   - otherwise → one `LocationLink` (targetSelectionRange narrower than targetRange).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.languages.registerImplementationProvider({ language: "typescript" }, {
            provideImplementation: function (document, position) {
                const implUri = vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), "impl.ts"));
                if (position.line === 0) {
                    return [
                        new vscode.Location(implUri, new vscode.Range(1, 4, 1, 8)),
                        new vscode.Location(implUri, new vscode.Range(4, 4, 4, 8)),
                    ];
                }
                return [
                    {
                        targetUri: implUri,
                        targetRange: new vscode.Range(4, 0, 6, 1),
                        targetSelectionRange: new vscode.Range(4, 4, 4, 8),
                    },
                ];
            },
        }),
    );
};
