"use strict";

/**
 * Демо `WorkspaceConfiguration.update`. Повторяет Bazel-плагин
 * (`tihonove.bazel-java-tihonove`): тот на старте читает
 * `bazel.projectview.open` и гасит его `getConfiguration("bazel.projectview")
 * .update("open", false)` — без цели, то есть в настройки воркспейса.
 *
 * - статус-бар показывает текущее `get("open")` и обновляется по
 *   `onDidChangeConfiguration` — запись видна без перезапуска;
 * - «Do Not Open Project View Again» пишет `false` и сразу после `await`
 *   читает значение обратно (эталон: к резолву `get()` уже видит запись);
 * - «Write Unregistered Key» пишет ключ, которого нет в реестре: хост
 *   отклоняет запись (`ERROR_UNKNOWN_KEY` эталона), расширение само
 *   показывает текст отказа — Diode тостов за него не рисует.
 *
 * Используется e2e-сценарием configurationUpdate и ручной проверкой:
 *   diode --user-data-dir=<каталог с этой фикстурой> <папка>
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
