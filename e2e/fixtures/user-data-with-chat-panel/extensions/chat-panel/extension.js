"use strict";

/**
 * Built like any chat extension: it sets up the webview FIRST, then registers everything else.
 * The TUI has no webviews by design, but the extension must not die because of it: the
 * `Chat Panel: Ping` command must reach the command palette and run.
 *
 * Code actions mimic the stock Supermaven ("Fix with Supermaven"): no edits, only a command with
 * a `vscode.Position` in its arguments. There are three providers (a fast and a slow quickfix, a disabled
 * refactoring) — the menu is assembled from several responses, as alongside tsserver.
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
            channel.appendLine("pong: the extension is alive even without a panel");
            channel.show();
            return "pong";
        }),
    );

    // Like `supermaven.sendFixRequestToChat`: the handler is synchronous, `.focus` is not awaited.
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
