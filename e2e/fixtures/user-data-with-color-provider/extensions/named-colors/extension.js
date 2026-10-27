"use strict";

/**
 * A square before CSS named colors: the built-in detector knows only hex/rgb/hsl, so a square on `red`
 * comes from this provider. `named-colors.toggle` disposes the registration and registers it again.
 */
const NAMED = {
    red: [1, 0, 0],
    green: [0, 0.5, 0],
    blue: [0, 0, 1],
    gold: [1, 0.84, 0],
};

exports.activate = function activate(context) {
    const vscode = require("vscode");

    const provider = {
        provideDocumentColors(document) {
            const text = document.getText();
            const colors = [];
            const re = /\b(red|green|blue|gold)\b/g;
            let match;
            while ((match = re.exec(text)) !== null) {
                const [r, g, b] = NAMED[match[1]];
                const range = new vscode.Range(
                    document.positionAt(match.index),
                    document.positionAt(match.index + match[0].length),
                );
                colors.push(new vscode.ColorInformation(range, new vscode.Color(r, g, b, 1)));
            }
            return colors;
        },
        provideColorPresentations() {
            return [];
        },
    };

    let registration = vscode.languages.registerColorProvider({ language: "css" }, provider);
    context.subscriptions.push(
        { dispose: () => registration?.dispose() },
        vscode.commands.registerCommand("named-colors.toggle", () => {
            if (registration) {
                registration.dispose();
                registration = undefined;
            } else {
                registration = vscode.languages.registerColorProvider({ language: "css" }, provider);
            }
        }),
    );
};

exports.deactivate = function deactivate() {};
