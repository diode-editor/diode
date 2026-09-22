"use strict";

/**
 * Демо-расширение чат-панели: устроено как любое расширение с чатом — СНАЧАЛА
 * поднимает свою webview-часть, и только потом регистрирует всё остальное
 * (команду палитры, свой output-канал).
 *
 * Webview в TUI не поддерживается by design, но убивать этим расширение целиком
 * нельзя: заглушка отвечает инертной панелью и пишет одну строку в Output, а
 * команда `Chat Panel: Ping` обязана доехать до палитры и исполниться.
 * Используется e2e-сценарием webviewNoop и ручным просмотром (--user-data-dir
 * с этой фикстурой).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("chatPanel.chatView", {
            resolveWebviewView: function (view) {
                view.webview.html = "<h1>chat</h1>";
            },
        }),
    );

    const channel = vscode.window.createOutputChannel("Chat Panel");
    context.subscriptions.push(channel);

    context.subscriptions.push(
        vscode.commands.registerCommand("chatPanel.ping", function () {
            channel.appendLine("pong — расширение живо, хотя панели нет");
            channel.show();
            return "pong";
        }),
    );
};

exports.deactivate = function deactivate() {};
