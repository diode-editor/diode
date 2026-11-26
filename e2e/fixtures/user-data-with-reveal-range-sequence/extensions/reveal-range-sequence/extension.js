"use strict";

/** `revealRange` with no delay after the call it follows: 0-based line 250 goes to the top row. */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const target = new vscode.Range(250, 0, 250, 0);

    context.subscriptions.push(
        vscode.commands.registerCommand("revealSequence.openAndReveal", async () => {
            const folder = vscode.workspace.workspaceFolders[0].uri;
            const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, "other.txt"));
            const editor = await vscode.window.showTextDocument(document);
            editor.revealRange(target, vscode.TextEditorRevealType.AtTop);
        }),
        vscode.commands.registerCommand("revealSequence.editAndReveal", async () => {
            const editor = vscode.window.activeTextEditor;
            await editor.edit((builder) => {
                builder.insert(new vscode.Position(editor.document.lineCount, 0), "appended\n");
            });
            editor.revealRange(target, vscode.TextEditorRevealType.AtTop);
        }),
    );
};
