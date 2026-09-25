"use strict";

/**
 * Фикстура для extensionHost.statusBar.test.ts: расширение ставит пункт в
 * статус-бар при активации и правит его командами, которые регистрирует само.
 * Так проверяется весь круг — `createStatusBarItem` → полоса → клик → команда
 * расширения → правка текста → обратно в полосу.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    item.name = "Status Bar Demo";
    item.text = "Demo";
    item.command = "test.statusBar.click";
    item.show();

    let clicks = 0;
    context.subscriptions.push(
        vscode.commands.registerCommand("test.statusBar.click", function () {
            clicks += 1;
            item.text = "Demo · clicked " + clicks;
            return clicks;
        }),
        vscode.commands.registerCommand("test.statusBar.setText", function (text) {
            item.text = text;
        }),
        vscode.commands.registerCommand("test.statusBar.hide", function () {
            item.hide();
        }),
        vscode.commands.registerCommand("test.statusBar.show", function () {
            item.show();
        }),
        vscode.commands.registerCommand("test.statusBar.dispose", function () {
            item.dispose();
        }),
        // Роняет собственный процесс — модель краша расширения. Выход отложен
        // на тик, чтобы ответ на RPC успел уйти вызывающему.
        vscode.commands.registerCommand("test.statusBar.kill", function () {
            setTimeout(function () {
                process.exit(1);
            }, 10);
            return "dying";
        }),
        vscode.commands.registerCommand("test.statusBar.createLeft", function () {
            const left = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
            left.text = "L-high";
            left.show();
        }),
        item,
    );
};
