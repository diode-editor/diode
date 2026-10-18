"use strict";

/**
 * Фикстура для extensionHost.completionResolve.test.ts: провайдер БЕЗ
 * `resolveCompletionItem`, правка авто-импорта приходит сразу в списке — как
 * у gopls (сервер не объявляет `resolveProvider`, languageclient resolve не
 * определяет).
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
