"use strict";

/**
 * Fixture for extensionHost.codeLens.test.ts. Above each `function NAME` line: a lens that shows references with real
 * `vscode` objects as arguments, and a lens without a command that `resolveCodeLens` completes with `Run`. A document
 * with `THROW` gets an exception, one with `FAILS` two more lenses: `Boom` (the command throws) and `Missing` (nobody
 * has that command). `providesCodeLens.refresh` changes a title and fires the event, `providesCodeLens.unregister`
 * disposes the registration, `providesCodeLens.runs` tells what the `Run` command received.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const marker = { notJson: new Map() };
    const runs = [];
    const changed = new vscode.EventEmitter();
    let references = "2 references";

    const registration = vscode.languages.registerCodeLensProvider(
        { language: "typescript" },
        {
            onDidChangeCodeLenses: changed.event,
            provideCodeLenses: function (document) {
                const text = document.getText();
                if (text.includes("THROW")) throw new Error("lenses exploded");
                const lenses = [];
                const re = /function (\w+)/g;
                let match;
                while ((match = re.exec(text)) !== null) {
                    const start = document.positionAt(match.index);
                    const range = new vscode.Range(start, start);
                    lenses.push(
                        new vscode.CodeLens(range, {
                            title: references,
                            command: "editor.action.showReferences",
                            arguments: [
                                document.uri,
                                start,
                                [
                                    new vscode.Location(document.uri, new vscode.Range(0, 0, 0, 3)),
                                    new vscode.Location(document.uri, new vscode.Range(1, 0, 1, 3)),
                                ],
                            ],
                        }),
                    );
                    lenses.push(new vscode.CodeLens(range));
                    if (text.includes("FAILS")) {
                        lenses.push(new vscode.CodeLens(range, { title: "Boom", command: "providesCodeLens.boom" }));
                        lenses.push(new vscode.CodeLens(range, { title: "Missing", command: "providesCodeLens.nope" }));
                    }
                }
                return lenses;
            },
            resolveCodeLens: function (lens) {
                // A new object on purpose: the command must be taken from what the resolve answered.
                return new vscode.CodeLens(lens.range, {
                    title: "Run",
                    command: "providesCodeLens.run",
                    arguments: [vscode.Uri.parse("file:///arg.ts"), lens.range.start, marker],
                });
            },
        },
    );

    context.subscriptions.push(
        registration,
        vscode.commands.registerCommand("providesCodeLens.run", function (uri, position, opaque) {
            runs.push({
                uri: uri instanceof vscode.Uri ? uri.toString() : null,
                isPosition: position instanceof vscode.Position,
                isMarker: opaque === marker,
            });
        }),
        vscode.commands.registerCommand("providesCodeLens.runs", function () {
            return runs;
        }),
        vscode.commands.registerCommand("providesCodeLens.boom", function () {
            throw new Error("command exploded");
        }),
        vscode.commands.registerCommand("providesCodeLens.refresh", function () {
            references = "3 references";
            changed.fire();
        }),
        vscode.commands.registerCommand("providesCodeLens.unregister", function () {
            registration.dispose();
        }),
    );
};
