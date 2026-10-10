"use strict";

/**
 * Демо-расширение чат-панели: устроено как любое расширение с чатом — СНАЧАЛА
 * поднимает свою webview-часть, и только потом регистрирует всё остальное
 * (команду палитры, свой output-канал, code actions «в чат»).
 *
 * Webview в TUI не поддерживается by design, но убивать этим расширение целиком
 * нельзя: заглушка отвечает инертной панелью и пишет одну строку в Output, а
 * команда `Chat Panel: Ping` обязана доехать до палитры и исполниться.
 *
 * Code actions повторяют стоковый Supermaven («Fix with Supermaven»): действие
 * без правок, только команда с `vscode.Position` в аргументах, а её обработчик
 * БЕЗ await зовёт `<вид>.focus` и шлёт сообщение в webview. Провайдеров три
 * (быстрый quickfix, медленный quickfix, неактивный рефакторинг) — так меню
 * собирается из нескольких ответов, как у живого пользователя рядом с tsserver.
 *
 * Используется e2e-сценариями webviewNoop и codeActionToChat и ручным
 * просмотром (--user-data-dir с этой фикстурой).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    let chatView;
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("chatPanel.chatView", {
            resolveWebviewView: function (view) {
                chatView = view;
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

    // Как `supermaven.sendFixRequestToChat`: синхронный обработчик, `.focus`
    // без await, сообщение — в webview, если он когда-нибудь поднимется.
    context.subscriptions.push(
        vscode.commands.registerCommand("chatPanel.sendFix", function (request) {
            vscode.commands.executeCommand("chatPanel.chatView.focus");
            channel.appendLine("fix request for line " + String(request.selection.start.line + 1) + " sent to chat");
            if (chatView !== undefined) chatView.webview.postMessage({ command: "fix", request: request });
        }),
    );

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider("*", {
            provideCodeActions: function (document, range) {
                const action = new vscode.CodeAction("Fix with Chat Panel", vscode.CodeActionKind.QuickFix);
                action.command = {
                    title: "Send Fix Request to Chat",
                    command: "chatPanel.sendFix",
                    arguments: [{ filePath: document.fileName, selection: { start: range.start, end: range.end } }],
                };
                return [action];
            },
        }),
    );
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider("*", {
            provideCodeActions: function () {
                return new Promise(function (resolve) {
                    setTimeout(function () {
                        const action = new vscode.CodeAction("Explain with Chat Panel", vscode.CodeActionKind.QuickFix);
                        action.command = { title: "Explain", command: "chatPanel.ping" };
                        resolve([action]);
                    }, 200);
                });
            },
        }),
    );
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider("*", {
            provideCodeActions: function () {
                const action = new vscode.CodeAction("Rewrite with Chat Panel", vscode.CodeActionKind.RefactorRewrite);
                action.disabled = { reason: "Select the code to rewrite first" };
                return [action];
            },
        }),
    );
};

exports.deactivate = function deactivate() {};
