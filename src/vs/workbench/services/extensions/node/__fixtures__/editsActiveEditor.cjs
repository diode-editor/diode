"use strict";

/**
 * Fixture for extensionHost.editorWrite.test.ts.
 * Registers commands that write to the active editor, the same path as the
 * maptz.regionfolder commands (selection setter + editor.edit).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    // Inserts "X" at the start of the document via editor.edit (an undoable batch).
    context.subscriptions.push(
        vscode.commands.registerCommand("test.insertX", async function () {
            const editor = vscode.window.activeTextEditor;
            if (editor == null) return false;
            return editor.edit(function (edit) {
                edit.insert(new vscode.Position(0, 0), "X");
            });
        }),
    );

    // Selects the whole first line.
    context.subscriptions.push(
        vscode.commands.registerCommand("test.selectFirstLine", function () {
            const editor = vscode.window.activeTextEditor;
            if (editor == null) return;
            editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 3));
        }),
    );

    // Returns the selection as the extension sees it RIGHT NOW. The same path as
    // real commands (maptz reads `ate.selection` and bails out on an empty one):
    // checks that the host relays cursor movement, not only tab changes.
    context.subscriptions.push(
        vscode.commands.registerCommand("test.readSelection", function () {
            const editor = vscode.window.activeTextEditor;
            if (editor == null) return null;
            const sel = editor.selection;
            return {
                anchorLine: sel.anchor.line,
                anchorCharacter: sel.anchor.character,
                activeLine: sel.active.line,
                activeCharacter: sel.active.character,
                count: editor.selections.length,
                isEmpty: sel.isEmpty,
            };
        }),
    );

    // A fire-and-forget call of a nonexistent core command: nobody catches the promise.
    // This is exactly what maptz does after wrapWithRegion (editor.action.formatDocument).
    context.subscriptions.push(
        vscode.commands.registerCommand("test.fireAndForgetMissingCommand", function () {
            void vscode.commands.executeCommand("no.such.core.command");
            return "issued";
        }),
    );

    // Number of visible editors (checks window.visibleTextEditors).
    context.subscriptions.push(
        vscode.commands.registerCommand("test.visibleCount", function () {
            return vscode.window.visibleTextEditors.length;
        }),
    );

    // Deletes the first line via editor.edit(delete).
    context.subscriptions.push(
        vscode.commands.registerCommand("test.deleteFirstLine", function () {
            const editor = vscode.window.activeTextEditor;
            if (editor == null) return false;
            return editor.edit(function (edit) {
                edit.delete(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(1, 0)));
            });
        }),
    );
};
