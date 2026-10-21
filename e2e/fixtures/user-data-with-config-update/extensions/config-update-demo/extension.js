"use strict";

/**
 * Повторяет Bazel-плагин (`tihonove.bazel-java-tihonove`): на старте гасит
 * `bazel.projectview.open` через `update("open", false)` без цели — в настройки воркспейса.
 * Сразу после `await update` значение читается обратно: эталон к резолву уже видит запись.
 * Незарегистрированный ключ хост отклоняет (`ERROR_UNKNOWN_KEY`), текст отказа показывает само
 * расширение — Diode тостов за него не рисует.
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
