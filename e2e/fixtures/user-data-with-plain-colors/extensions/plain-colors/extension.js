"use strict";

// E2E fixture: colors the WORD `red` in plain text. The built-in detector does not see named colors, so a
// square before `red` can only come from this extension.
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.languages.registerColorProvider(
            { language: "plaintext" },
            {
                provideDocumentColors(document) {
                    const text = document.getText();
                    const colors = [];
                    const re = /\bred\b/g;
                    let match;
                    while ((match = re.exec(text)) !== null) {
                        const range = new vscode.Range(
                            document.positionAt(match.index),
                            document.positionAt(match.index + match[0].length),
                        );
                        colors.push(new vscode.ColorInformation(range, new vscode.Color(1, 0, 0, 1)));
                    }
                    return colors;
                },
                provideColorPresentations() {
                    return [];
                },
            },
        ),
    );
};
