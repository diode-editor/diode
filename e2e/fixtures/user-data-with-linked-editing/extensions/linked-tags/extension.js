"use strict";

const vscode = require("vscode");

/** Links the name in `<name></name>` on the line of the position; letters only, so a space breaks the link. */
exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.languages.registerLinkedEditingRangeProvider(
            { language: "plaintext" },
            {
                provideLinkedEditingRanges(document, position) {
                    const match = /^<([a-z]*)><\/([a-z]*)>/.exec(document.lineAt(position.line).text);
                    if (match === null) return null;
                    const line = position.line;
                    const open = new vscode.Range(line, 1, line, 1 + match[1].length);
                    const closeStart = match[1].length + 4;
                    const close = new vscode.Range(line, closeStart, line, closeStart + match[2].length);
                    if (!open.contains(position) && !close.contains(position)) return null;
                    return new vscode.LinkedEditingRanges([open, close], /[a-z]+/);
                },
            },
        ),
    );
    // `editor.action.linkedEditing` needs a rename provider, as upstream.
    context.subscriptions.push(
        vscode.languages.registerRenameProvider(
            { language: "plaintext" },
            { provideRenameEdits: () => new vscode.WorkspaceEdit() },
        ),
    );
};
