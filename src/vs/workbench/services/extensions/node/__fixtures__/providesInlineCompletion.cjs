"use strict";

/**
 * Фикстура для extensionHost.inlineCompletion.test.ts. Регистрирует
 * inline-completion-провайдер для typescript, который отдаёт два пункта:
 * многострочный plain-текст (тело функции) и SnippetString с range/filterText
 * (проверка стрипа плейсхолдеров и проезда полей через wire).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            {
                provideInlineCompletionItems: function (document, position) {
                    const body = new vscode.InlineCompletionItem("(n) {\n    return n;\n}");
                    const snippet = new vscode.InlineCompletionItem(
                        new vscode.SnippetString("fibonacci(${1:n})$0"),
                        new vscode.Range(position.line, 9, position.line, position.character),
                    );
                    snippet.filterText = "fibonacci";
                    return [body, snippet];
                },
            },
        ),
    );
};
