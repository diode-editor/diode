"use strict";

/**
 * Rename provider fixture: renames the word `value` in the active
 * document and in the sibling file `other.txt` (a cross-file edit, exactly what
 * rename goes through a bulk workspace edit for).
 *
 * `prepareRename` branches are picked by the cursor line, covering both upstream
 * answer shapes and a refusal:
 *   - line 0 → `{ range, placeholder }`;
 *   - line 1 → a bare `Range` (the placeholder is filled from the range text);
 *   - line 2 → refusal ("cannot rename here").
 *
 * `provideRenameEdits` rejects the invalid name `class`: upstream's regular
 * "name is not valid" channel.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const path = require("node:path");

    context.subscriptions.push(
        vscode.languages.registerRenameProvider(
            { language: "plaintext" },
            {
                prepareRename: function (document, position) {
                    if (position.line === 2) {
                        return Promise.reject(new Error("You cannot rename this element."));
                    }
                    const range = new vscode.Range(0, 6, 0, 11);
                    if (position.line === 1) return range;
                    return { range: range, placeholder: "value" };
                },
                provideRenameEdits: function (document, position, newName) {
                    if (newName === "class") {
                        return Promise.reject(new Error("'class' is not a valid identifier"));
                    }
                    if (newName === "nothing") return null;
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(document.uri, new vscode.Range(0, 6, 0, 11), newName);
                    const neighbour = vscode.Uri.file(path.join(path.dirname(document.uri.fsPath), "other.txt"));
                    edit.replace(neighbour, new vscode.Range(0, 0, 0, 5), newName);
                    return edit;
                },
            },
        ),
    );
};
