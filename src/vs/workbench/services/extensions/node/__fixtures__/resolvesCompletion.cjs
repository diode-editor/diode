"use strict";

/**
 * Fixture for extensionHost.completionResolve.test.ts: a provider with
 * `resolveCompletionItem` and a trigger character. The documentation and the auto-import edit
 * are returned ONLY on resolve, the way a real language server does it.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: "editorconfig", pattern: "**/.editorconfig" },
            {
                provideCompletionItems: function () {
                    return [new vscode.CompletionItem("indent_style", vscode.CompletionItemKind.Property)];
                },
                resolveCompletionItem: function (item) {
                    item.detail = "resolved detail";
                    item.documentation = new vscode.MarkdownString("resolved docs");
                    item.additionalTextEdits = [
                        new vscode.TextEdit(new vscode.Range(0, 0, 0, 0), "# header\n"),
                    ];
                    return item;
                },
            },
            ".",
            "=",
        ),
    );
};
