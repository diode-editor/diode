"use strict";

/** Puts spaces around the first `=` without them on the line of the position, on `;` and on Enter. */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.languages.registerOnTypeFormattingEditProvider(
            { language: "typescript" },
            {
                provideOnTypeFormattingEdits: function (document, position, ch) {
                    const line = ch === "\n" ? position.line - 1 : position.line;
                    const index = document.lineAt(line).text.search(/[^ ]=[^ ]/);
                    if (index < 0) return [];
                    return [vscode.TextEdit.replace(new vscode.Range(line, index + 1, line, index + 2), " = ")];
                },
            },
            ";",
            "\n",
        ),
    );
};
