"use strict";

/** Lenses on the first line, each with a command that fails in its own way. */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const range = new vscode.Range(0, 0, 0, 0);

    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: "typescript" },
            {
                provideCodeLenses: function () {
                    return [
                        new vscode.CodeLens(range, { title: "Missing", command: "failing.nope" }),
                        new vscode.CodeLens(range, { title: "ThrowError", command: "failing.error" }),
                        new vscode.CodeLens(range, { title: "ThrowString", command: "failing.string" }),
                        new vscode.CodeLens(range, { title: "ThrowNothing", command: "failing.undefined" }),
                    ];
                },
            },
        ),
        vscode.commands.registerCommand("failing.error", function () {
            throw new Error("command exploded");
        }),
        vscode.commands.registerCommand("failing.string", function () {
            throw "plain string failure";
        }),
        vscode.commands.registerCommand("failing.undefined", function () {
            throw undefined;
        }),
    );
};
