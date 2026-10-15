"use strict";

/**
 * Демо `window.setStatusBarMessage` (сценарий status-bar-message): при
 * активации — сообщение без таймаута, по команде — второе поверх него на 3 с;
 * уехав, оно возвращает первое (стек, как у эталона). Вторая команда
 * показывает константы `env`, которые знает только хост.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.window.setStatusBarMessage("Demo: watching"),
        vscode.commands.registerCommand("statusMessageDemo.timed", function () {
            vscode.window.setStatusBarMessage("Demo: no change", 3000);
        }),
        vscode.commands.registerCommand("statusMessageDemo.env", function () {
            const shell = vscode.env.shell.split("/").pop();
            const id = /^[0-9a-f]{64}$/.test(vscode.env.machineId) ? "sha256" : "uuid";
            vscode.window.showInformationMessage("env.shell: " + shell + " · env.machineId: " + id);
        }),
    );
};
