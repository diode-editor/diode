"use strict";

/**
 * Устроено как любое расширение с чатом: СНАЧАЛА поднимает webview, потом регистрирует остальное.
 * Webview в TUI нет by design, но расширение от этого умереть не должно: команда
 * `Chat Panel: Ping` обязана доехать до палитры и исполниться.
 *
 * Code actions — как у стокового Supermaven («Fix with Supermaven»): без правок, только команда с
 * `vscode.Position` в аргументах. Провайдеров три (быстрый и медленный quickfix, неактивный
 * рефакторинг) — меню собирается из нескольких ответов, как рядом с tsserver.
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

    // Как `supermaven.sendFixRequestToChat`: обработчик синхронный, `.focus` без await.
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
