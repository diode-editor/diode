"use strict";

/**
 * Mimics the Bazel plugin (`tihonove.bazel-java-tihonove`): on startup it turns off
 * `bazel.projectview.open` via `update("open", false)` with no target — into workspace settings.
 * Right after `await update` the value is read back: in upstream the write is already visible once it resolves.
 * The host rejects an unregistered key (`ERROR_UNKNOWN_KEY`); the extension shows the rejection text
 * itself — Diode does not draw toasts on its behalf.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    const render = () => {
        const open = vscode.workspace.getConfiguration("configUpdateDemo.projectview").get("open");
        item.text = `projectview.open=${String(open)}`;
    };
    render();
    item.show();
    context.subscriptions.push(item);

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("configUpdateDemo.projectview.open")) render();
        }),
        vscode.commands.registerCommand("configUpdateDemo.dontOpen", async () => {
            await vscode.workspace.getConfiguration("configUpdateDemo.projectview").update("open", false);
            const after = vscode.workspace.getConfiguration("configUpdateDemo.projectview").get("open");
            void vscode.window.showInformationMessage(`After await update(): open=${String(after)}`);
        }),
        vscode.commands.registerCommand("configUpdateDemo.writeUnknown", async () => {
            try {
                await vscode.workspace.getConfiguration("configUpdateDemo").update("notDeclared", 1);
            } catch (error) {
                void vscode.window.showErrorMessage(`Rejected: ${error.message}`);
            }
        }),
    );
};
