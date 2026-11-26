"use strict";

/**
 * Angular's embedded templates in miniature: `.html` documents served by a `TextDocumentContentProvider` without
 * `onDidChange`, whose text changes before each `vscode.executeCompletionItemProvider` /
 * `vscode.executeHoverProvider`. The HTML client's selector is not limited to the `file` scheme, so the commands reach
 * the HTML server (extensionHost.htmlLsp.virtualDocument.test.ts).
 */
const contents = new Map();

exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider("embedded-html", {
            provideTextDocumentContent: function (uri) {
                return contents.get(uri.path);
            },
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("fixture.completeVirtualHtml", async function (text, character) {
            const uri = vscode.Uri.parse("embedded-html:/template.html");
            contents.set(uri.path, text);
            const list = await vscode.commands.executeCommand(
                "vscode.executeCompletionItemProvider",
                uri,
                new vscode.Position(0, character),
            );
            return list.items.map(function (item) {
                return typeof item.label === "string" ? item.label : item.label.label;
            });
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("fixture.hoverVirtualHtml", async function (text, character) {
            const uri = vscode.Uri.parse("embedded-html:/hover.html");
            contents.set(uri.path, text);
            const hovers = await vscode.commands.executeCommand(
                "vscode.executeHoverProvider",
                uri,
                new vscode.Position(0, character),
            );
            return hovers.flatMap(function (hover) {
                return hover.contents.map(function (content) {
                    return typeof content === "string" ? content : content.value;
                });
            });
        }),
    );
};
