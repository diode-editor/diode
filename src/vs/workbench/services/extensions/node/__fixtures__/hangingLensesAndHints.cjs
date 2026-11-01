"use strict";

/**
 * Fixture for extensionHost.hangingProviders.test.ts: providers that never answer, as a language server busy with its
 * import. A document with `HANG` gets no answer from provideCodeLenses and provideInlayHints. `resolveCodeLens` of the
 * first lens over a `function slow` never answers; every later call does. `hanging.hung` tells which requests are
 * left without an answer, `hanging.cancelled` which of them saw their token cancelled.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const hung = [];
    const cancelled = [];
    const hungLines = new Set();

    const hang = function (token, name) {
        hung.push(name);
        return new Promise(function () {
            token.onCancellationRequested(function () {
                cancelled.push(name);
            });
        });
    };

    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: "typescript" },
            {
                provideCodeLenses: function (document, token) {
                    const text = document.getText();
                    if (text.includes("HANG")) return hang(token, "provideCodeLenses");
                    const lenses = [];
                    const re = /function (\w+)/g;
                    let match;
                    while ((match = re.exec(text)) !== null) {
                        const start = document.positionAt(match.index);
                        lenses.push(new vscode.CodeLens(new vscode.Range(start, start)));
                    }
                    return lenses;
                },
                resolveCodeLens: function (lens, token) {
                    const line = lens.range.start.line;
                    const document = vscode.window.activeTextEditor.document;
                    const name = /function (\w+)/.exec(document.lineAt(line).text)[1];
                    if (name === "slow" && !hungLines.has(line)) {
                        hungLines.add(line);
                        return hang(token, "resolveCodeLens");
                    }
                    lens.command = { title: "resolved " + name, command: "hanging.cancelled" };
                    return lens;
                },
            },
        ),
        vscode.languages.registerInlayHintsProvider(
            { language: "typescript" },
            {
                provideInlayHints: function (document, range, token) {
                    if (document.getText().includes("HANG")) return hang(token, "provideInlayHints");
                    return [new vscode.InlayHint(new vscode.Position(0, 7), ": number")];
                },
            },
        ),
        vscode.commands.registerCommand("hanging.hung", function () {
            return hung;
        }),
        vscode.commands.registerCommand("hanging.cancelled", function () {
            return cancelled;
        }),
    );
};
