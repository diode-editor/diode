"use strict";

/**
 * Fixture for extensionHost.colors.edges.test.ts — provider B, a second extension next to A: colors the word
 * `gold` on css. Plus selector probes on the same document (`main.css`, scheme `file`): `{ pattern:
 * "**\/*.css" }` colors `green`, `{ scheme: "untitled" }` colors `navy`, `{ language: "scss" }` colors `pink`.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    function wordProvider(word, color) {
        return {
            provideDocumentColors: function (document) {
                const text = document.getText();
                const colors = [];
                const re = new RegExp("\\b" + word + "\\b", "g");
                let match;
                while ((match = re.exec(text)) !== null) {
                    const range = new vscode.Range(
                        document.positionAt(match.index),
                        document.positionAt(match.index + word.length),
                    );
                    colors.push(new vscode.ColorInformation(range, color));
                }
                return colors;
            },
            provideColorPresentations: function () {
                return [];
            },
        };
    }

    context.subscriptions.push(
        vscode.languages.registerColorProvider(
            { language: "css" },
            wordProvider("gold", new vscode.Color(1, 0.84, 0, 1)),
        ),
        vscode.languages.registerColorProvider(
            { pattern: "**/*.css" },
            wordProvider("green", new vscode.Color(0, 0.5, 0, 1)),
        ),
        vscode.languages.registerColorProvider(
            { scheme: "untitled" },
            wordProvider("navy", new vscode.Color(0, 0, 0.5, 1)),
        ),
        vscode.languages.registerColorProvider(
            { language: "scss" },
            wordProvider("pink", new vscode.Color(1, 0.75, 0.8, 1)),
        ),
    );
};
