"use strict";

/**
 * Читает `vscode.workspace` ОДИН раз, в `activate()`, как настоящие расширения (языковой клиент
 * отдаёт папки серверу в `initialize`): новое значение в полосе значит, что процесс расширений
 * поднят заново. Текст короткий — пункт длиннее ~24 символов усекается.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    item.name = "Workspace Probe";
    item.text = vscode.workspace.name;
    item.show();
    context.subscriptions.push(item);
};

exports.deactivate = function deactivate() {};
