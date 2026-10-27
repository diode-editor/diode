"use strict";

/**
 * Fixture for extensionHost.colors.test.ts: a color provider for css that colors the WORDS `red` and
 * `blue` — the built-in detector does not see named colors, so a square on them can only come from the
 * extension. A document with `NONE` gets an empty answer, with `THROW` — an exception; its colors
 * are then the built-in detector's (`auto`). `providesColors.unregister` disposes the registration.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const NAMED = { red: new vscode.Color(1, 0, 0, 1), blue: new vscode.Color(0, 0, 1, 1) };

    const registration = vscode.languages.registerColorProvider(
        { language: "css" },
        {
            provideDocumentColors: function (document) {
                const text = document.getText();
                if (text.includes("THROW")) throw new Error("colors exploded");
                if (text.includes("NONE")) return [];
                const colors = [];
                const re = /\b(red|blue)\b/g;
                let match;
                while ((match = re.exec(text)) !== null) {
                    const start = document.positionAt(match.index);
                    const end = document.positionAt(match.index + match[0].length);
                    colors.push(new vscode.ColorInformation(new vscode.Range(start, end), NAMED[match[1]]));
                }
                return colors;
            },
            provideColorPresentations: function () {
                throw new Error("there is no color picker: never called");
            },
        },
    );
    context.subscriptions.push(
        registration,
        vscode.commands.registerCommand("providesColors.unregister", function () {
            registration.dispose();
        }),
    );
};
