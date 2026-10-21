"use strict";

/**
 * Selection range provider fixture: for every position, a chain
 * "line of the position" -> "that line and the next one". The second step matches
 * none of the built-in ones (word, brackets, line, document), so it shows up
 * in the final hierarchy, which proves the provider's answer arrived.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.languages.registerSelectionRangeProvider(
            { language: "plaintext" },
            {
                provideSelectionRanges: function (document, positions) {
                    return positions.map(function (position) {
                        const line = document.lineAt(position.line).range;
                        const next = document.lineAt(position.line + 1).range;
                        const pair = new vscode.SelectionRange(new vscode.Range(line.start, next.end));
                        return new vscode.SelectionRange(line, pair);
                    });
                },
            },
        ),
    );
};
