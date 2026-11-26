"use strict";

/**
 * Linked editing provider fixture for `<aaa></aaa>`: the name in both tags, whichever is under the position, and
 * nothing elsewhere. The word pattern stops at a digit, so typing one breaks the link.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.languages.registerLinkedEditingRangeProvider(
            { language: "typescript" },
            {
                provideLinkedEditingRanges: function (document, position) {
                    const match = /^<([a-z]*)><\/([a-z]*)>/.exec(document.lineAt(0).text);
                    if (match === null || position.line !== 0) return null;
                    const open = new vscode.Range(0, 1, 0, 1 + match[1].length);
                    const closeStart = match[1].length + 4;
                    const close = new vscode.Range(0, closeStart, 0, closeStart + match[2].length);
                    if (!open.contains(position) && !close.contains(position)) return null;
                    return new vscode.LinkedEditingRanges([open, close], /[a-z]+/);
                },
            },
        ),
    );
};
