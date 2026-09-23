"use strict";

/**
 * Фикстура для extensionHost.webviewNoop.test.ts — типовое расширение с чат-панелью.
 *
 * Сначала поднимает свою webview-часть (какой именно член зовём — из конфигурации
 * `testChat.webviewApi`, чтобы тест прошёлся по всем трём точкам входа), и только
 * ПОТОМ регистрирует не-webview часть: команду `test.chatPing` и
 * inline-completion-провайдер (призрачные подсказки).
 *
 * Наблюдаемое в тесте — именно вторая половина: webview в TUI не будет, а вот
 * команды и провайдеры расширения обязаны пережить webview-вызов.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const api = vscode.workspace.getConfiguration("testChat").get("webviewApi");

    if (api === "createWebviewPanel") {
        const panel = vscode.window.createWebviewPanel("test.chat", "Chat", vscode.ViewColumn.One, {});
        // Так делает любое расширение с панелью сразу после создания.
        panel.webview.html = "<h1>chat</h1>";
        context.subscriptions.push(panel);
    } else if (api === "registerWebviewViewProvider") {
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider("test.chatView", {
                resolveWebviewView: function (view) {
                    view.webview.html = "<h1>chat</h1>";
                },
            }),
        );
    } else {
        context.subscriptions.push(
            vscode.window.registerWebviewPanelSerializer("test.chat", {
                deserializeWebviewPanel: function () {
                    return Promise.resolve();
                },
            }),
        );
    }

    context.subscriptions.push(
        vscode.commands.registerCommand("test.chatPing", function () {
            return "pong";
        }),
    );

    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            {
                provideInlineCompletionItems: function () {
                    return [new vscode.InlineCompletionItem("GHOST")];
                },
            },
        ),
    );
};
