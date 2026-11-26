"use strict";

/**
 * Above each `function NAME`: `2 references` opens the references view with two locations, `Run` comes from
 * `resolveCodeLens` and appends a line with what its command received, so the frame shows the arguments are real objects.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: "typescript" },
            {
                provideCodeLenses: function (document) {
                    const lenses = [];
                    const re = /function \w+/g;
                    const text = document.getText();
                    let match;
                    while ((match = re.exec(text)) !== null) {
                        const start = document.positionAt(match.index);
                        const range = new vscode.Range(start, start);
                        const locations = [
                            new vscode.Location(document.uri, new vscode.Range(0, 9, 0, 14)),
                            new vscode.Location(document.uri, new vscode.Range(1, 9, 1, 14)),
                        ];
                        lenses.push(
                            new vscode.CodeLens(range, {
                                title: "2 references",
                                command: "editor.action.showReferences",
                                arguments: [document.uri, start, locations],
                            }),
                        );
                        lenses.push(new vscode.CodeLens(range));
                    }
                    return lenses;
                },
                resolveCodeLens: function (lens) {
                    lens.command = { title: "Run", command: "demoCodeLens.run", arguments: [lens.range.start] };
                    return lens;
                },
            },
        ),
        vscode.commands.registerCommand("demoCodeLens.run", function (position) {
            const editor = vscode.window.activeTextEditor;
            const end = editor.document.lineAt(editor.document.lineCount - 1).range.end;
            const kind = position instanceof vscode.Position ? "Position" : typeof position;
            return editor.edit(function (edit) {
                edit.insert(end, `// ran with a ${kind}\n`);
            });
        }),
    );
};
