"use strict";

/**
 * An `.html` document served by a `TextDocumentContentProvider`, as Angular's embedded templates are: the HTML client's
 * selector is not limited to the `file` scheme, so `vscode.executeCompletionItemProvider` on the virtual document
 * reaches the HTML server (extensionHost.htmlLsp.embedded.test.ts).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider("embedded-html", {
            provideTextDocumentContent: function () {
                return "<di\n";
            },
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("fixture.completeVirtualHtml", async function () {
            const uri = vscode.Uri.parse("embedded-html:/template.html");
            const document = await vscode.workspace.openTextDocument(uri);
            const list = await vscode.commands.executeCommand(
                "vscode.executeCompletionItemProvider",
                uri,
                new vscode.Position(0, 3),
            );
            return {
                languageId: document.languageId,
                labels: list.items.map(function (item) {
                    return typeof item.label === "string" ? item.label : item.label.label;
                }),
            };
        }),
    );
};
