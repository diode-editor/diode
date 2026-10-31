"use strict";

// Opens the second file of the workspace beside the first and reports what the API sees right after
// `showTextDocument` resolves: the frame shows two groups, the toast shows the contract.
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.commands.registerCommand("showBesideDemo.open", async function () {
            const root = vscode.workspace.workspaceFolders[0].uri;
            const left = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, "left.txt"));
            const right = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, "right.txt"));
            await vscode.window.showTextDocument(left, vscode.ViewColumn.One);
            const shown = await vscode.window.showTextDocument(right, vscode.ViewColumn.Beside);
            const active = vscode.window.activeTextEditor;
            const verdict = active === shown && active.document === right ? "same" : "different";
            void vscode.window.showInformationMessage(`active editor: ${verdict}, column ${String(active.viewColumn)}`);
        }),
    );
};
