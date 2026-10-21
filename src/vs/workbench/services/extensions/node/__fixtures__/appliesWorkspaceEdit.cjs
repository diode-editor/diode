"use strict";

/**
 * workspace.applyEdit fixture (#196): commands build a WorkspaceEdit and apply it
 * via vscode.workspace.applyEdit, the same path that code action edits and
 * server-side workspace/applyEdit of the stock vscode-languageclient will take.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    // Replaces [0:0..0:5] of the active document with "HELLO".
    context.subscriptions.push(
        vscode.commands.registerCommand("test.applyReplaceActive", function () {
            const editor = vscode.window.activeTextEditor;
            if (editor == null) return null;
            const edit = new vscode.WorkspaceEdit();
            edit.replace(editor.document.uri, new vscode.Range(0, 0, 0, 5), "HELLO");
            return vscode.workspace.applyEdit(edit);
        }),
    );

    // Inserts "X" at the start of each given file (an array of fsPath).
    context.subscriptions.push(
        vscode.commands.registerCommand("test.applyToFiles", function (paths) {
            const edit = new vscode.WorkspaceEdit();
            for (const p of paths) {
                edit.insert(vscode.Uri.file(p), new vscode.Position(0, 0), "X");
            }
            return vscode.workspace.applyEdit(edit);
        }),
    );

    // A text edit of the active document plus a rename of a sibling file:
    // a mixed edit, like a rename refactoring.
    context.subscriptions.push(
        vscode.commands.registerCommand("test.applyRenameWithText", function (paths) {
            const editor = vscode.window.activeTextEditor;
            if (editor == null) return null;
            const edit = new vscode.WorkspaceEdit();
            edit.replace(editor.document.uri, new vscode.Range(0, 0, 0, 1), "Y");
            edit.renameFile(vscode.Uri.file(paths[0]), vscode.Uri.file(paths[1]));
            return vscode.workspace.applyEdit(edit);
        }),
    );

    // "Move to a new file": create a file with content, append to it, delete
    // the original. The order of operations matters.
    context.subscriptions.push(
        vscode.commands.registerCommand("test.applyMoveToNewFile", function (paths) {
            const created = vscode.Uri.file(paths[0]);
            const removed = vscode.Uri.file(paths[1]);
            const edit = new vscode.WorkspaceEdit();
            edit.createFile(created, { contents: new TextEncoder().encode("moved\n") });
            edit.insert(created, new vscode.Position(1, 0), "tail\n");
            edit.deleteFile(removed);
            return vscode.workspace.applyEdit(edit);
        }),
    );
};
