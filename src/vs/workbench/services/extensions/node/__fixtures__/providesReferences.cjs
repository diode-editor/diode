"use strict";

/**
 * References provider fixture: registers TWO providers for typescript, so
 * merging results of several providers is checked through a real
 * subprocess, not only against an RPC stub.
 *   - first  → a reference in the same file; returns the declaration only when
 *     `context.includeDeclaration` is set (checks that the context arrives);
 *   - second → a reference in a sibling file (the cross-file case);
 *   - on line 1 both stay silent (empty answer).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.languages.registerReferenceProvider({ language: "typescript" }, {
            provideReferences: function (document, position, refContext) {
                if (position.line !== 0) return [];
                const here = [new vscode.Location(document.uri, new vscode.Range(0, 6, 0, 12))];
                if (!refContext.includeDeclaration) return here;
                return [new vscode.Location(document.uri, new vscode.Range(0, 0, 0, 5))].concat(here);
            },
        }),
        vscode.languages.registerReferenceProvider({ language: "typescript" }, {
            provideReferences: function (document, position) {
                if (position.line !== 0) return [];
                const other = document.uri.toString().replace("main.ts", "other.ts");
                return [new vscode.Location(vscode.Uri.parse(other), new vscode.Range(7, 2, 7, 8))];
            },
        }),
    );
};
