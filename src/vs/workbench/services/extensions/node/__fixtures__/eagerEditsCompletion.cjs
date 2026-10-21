"use strict";

/**
 * Fixture for extensionHost.completionResolve.test.ts: a provider WITHOUT
 * `resolveCompletionItem`, the auto-import edit arrives right in the list, as
 * with gopls (the server does not declare `resolveProvider`, languageclient does
 * not define resolve).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: "editorconfig", pattern: "**/.editorconfig" },
            {
                provideCompletionItems: function () {
                    const item = new vscode.CompletionItem("indent_style", vscode.CompletionItemKind.Property);
                    item.additionalTextEdits = [
                        new vscode.TextEdit(new vscode.Range(0, 0, 0, 0), "# header\n"),
                        { bogus: true },
                    ];
                    return [item];
                },
            },
        ),
    );
};
