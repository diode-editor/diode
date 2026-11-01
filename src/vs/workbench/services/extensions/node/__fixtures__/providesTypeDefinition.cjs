"use strict";

const path = require("node:path");

/**
 * Type definition and declaration provider fixture for typescript documents, with targets in the
 * `types.ts` file next to the requested document:
 *   - type definition on line 0 → two `vscode.Location`s (types.ts:1:4–1:8 and types.ts:4:4–4:8);
 *   - type definition on other lines → one `LocationLink` (targetSelectionRange narrower than targetRange);
 *   - declaration → one `vscode.Location` (types.ts:7:0–7:5).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const typesUri = (document) => vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), "types.ts"));
    context.subscriptions.push(
        vscode.languages.registerTypeDefinitionProvider({ language: "typescript" }, {
            provideTypeDefinition: function (document, position) {
                if (position.line === 0) {
                    return [
                        new vscode.Location(typesUri(document), new vscode.Range(1, 4, 1, 8)),
                        new vscode.Location(typesUri(document), new vscode.Range(4, 4, 4, 8)),
                    ];
                }
                return [
                    {
                        targetUri: typesUri(document),
                        targetRange: new vscode.Range(4, 0, 6, 1),
                        targetSelectionRange: new vscode.Range(4, 4, 4, 8),
                    },
                ];
            },
        }),
        vscode.languages.registerDeclarationProvider({ language: "typescript" }, {
            provideDeclaration: function (document) {
                return new vscode.Location(typesUri(document), new vscode.Range(7, 0, 7, 5));
            },
        }),
    );
};
