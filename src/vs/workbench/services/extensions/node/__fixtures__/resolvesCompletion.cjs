"use strict";

/**
 * Фикстура для extensionHost.completionResolve.test.ts: провайдер с
 * `resolveCompletionItem` и триггер-символом. Описание и правка авто-импорта
 * отдаются ТОЛЬКО на resolve — как это делает настоящий language server.
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
