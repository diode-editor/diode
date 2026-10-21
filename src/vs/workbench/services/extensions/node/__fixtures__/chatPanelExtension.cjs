"use strict";

/**
 * Fixture for extensionHost.webviewNoop.test.ts: a typical extension with a chat panel.
 *
 * First it brings up its webview part (which member we call comes from the
 * `testChat.webviewApi` setting, so the test goes through all three entry points), and
 * only THEN registers the non-webview part: command `test.chatPing` and an
 * inline completion provider (ghost suggestions).
 *
 * What the test observes is the second half: there will be no webview in the TUI, but
 * the extension's commands and providers must survive the webview call.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const api = vscode.workspace.getConfiguration("testChat").get("webviewApi");

    if (api === "createWebviewPanel") {
        const panel = vscode.window.createWebviewPanel("test.chat", "Chat", vscode.ViewColumn.One, {});
        // Any extension with a panel does this right after creating it.
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
