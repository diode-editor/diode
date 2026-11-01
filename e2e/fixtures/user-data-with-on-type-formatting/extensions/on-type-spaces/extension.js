"use strict";

const vscode = require("vscode");

/** Puts spaces around the first `=` without them on the line of the position. */
exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.languages.registerOnTypeFormattingEditProvider(
            { language: "plaintext" },
            {
                provideOnTypeFormattingEdits(document, position) {
                    const index = document.lineAt(position.line).text.search(/[^ ]=[^ ]/);
                    if (index < 0) return [];
                    const line = position.line;
                    return [vscode.TextEdit.replace(new vscode.Range(line, index + 1, line, index + 2), " = ")];
                },
            },
            ";",
        ),
    );
};
