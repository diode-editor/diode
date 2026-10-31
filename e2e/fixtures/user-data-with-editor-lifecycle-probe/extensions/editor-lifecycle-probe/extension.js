"use strict";

// Each command reports what the extension observed on a toast, so the test reads it from the frame.
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const uri = (name) => vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, name);
    const name = (editor) => (editor ? editor.document.uri.path.split("/").pop() : "none");
    const report = (text) => void vscode.window.showInformationMessage(text);

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection((e) => {
            if (e.kind === vscode.TextEditorSelectionChangeKind.Mouse) {
                report(`mouse selection in ${name(e.textEditor)}`);
            }
        }),
        vscode.commands.registerCommand("editorLifecycleProbe.beside", async () => {
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri("left.txt")), vscode.ViewColumn.One);
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri("right.txt")), vscode.ViewColumn.Beside);
            report("beside done");
        }),
        vscode.commands.registerCommand("editorLifecycleProbe.diff", async () => {
            await vscode.commands.executeCommand("vscode.diff", uri("left.txt"), uri("right.txt"), "probe diff");
            report(`active after diff: ${name(vscode.window.activeTextEditor)}`);
        }),
        vscode.commands.registerCommand("editorLifecycleProbe.showMissing", async () => {
            try {
                await vscode.window.showTextDocument(uri("missing.txt"));
                report("show missing: resolved");
            } catch {
                report("show missing: rejected");
            }
        }),
    );
};
