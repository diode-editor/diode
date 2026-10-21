"use strict";

const path = require("node:path");

/**
 * Definition provider fixture: for typescript documents returns a target in
 * the `defs.ts` file next to the requested document. The result shape depends on
 * the cursor line, covering both normalization branches:
 *   - line 0 → a single `vscode.Location` (defs.ts:2:4–2:9);
 *   - otherwise → a `LocationLink` array (targetSelectionRange narrower than targetRange).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider({ language: "typescript" }, {
            provideDefinition: function (document, position) {
                const defsUri = vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), "defs.ts"));
                if (position.line === 0) {
                    return new vscode.Location(defsUri, new vscode.Range(2, 4, 2, 9));
                }
                return [
                    {
                        targetUri: defsUri,
                        targetRange: new vscode.Range(5, 0, 8, 1),
                        targetSelectionRange: new vscode.Range(5, 9, 5, 14),
                    },
                ];
            },
        }),
    );
};
