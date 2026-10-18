"use strict";

/**
 * Демо `workspace.saveAll` (сценарий workspace-save-all): команда сохраняет
 * все несохранённые файлы — так golang.go делает перед `gopls.tidy` и
 * vulncheck — и выводит ответ хоста пунктом статус-бара.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const result = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    context.subscriptions.push(
        result,
        vscode.commands.registerCommand("saveAllDemo.run", async () => {
            const saved = await vscode.workspace.saveAll(false);
            result.text = `saveAll: ${String(saved)}`;
            result.show();
        }),
    );
};
