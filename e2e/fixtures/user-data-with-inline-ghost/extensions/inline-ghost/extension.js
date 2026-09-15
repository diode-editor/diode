"use strict";

/**
 * Демо-расширение призрачных подсказок: фейковый «LLM», который отдаёт
 * канированные продолжения по хвосту набранной строки — с искусственной
 * задержкой ~250 мс, как настоящий модельный бэкенд. Используется e2e-сценарием
 * inlineCompletion и ручным просмотром (--user-data-dir с этой фикстурой).
 */
const SUGGESTIONS = [
    {
        trigger: "function fib",
        insertText: "onacci(n) {\n    if (n <= 1) return n;\n    return fibonacci(n - 1) + fibonacci(n - 2);\n}",
    },
    { trigger: "const greeting", insertText: ' = "Hello from ghost text!";' },
    { trigger: "console.l", insertText: "og(greeting);" },
];

const RESPONSE_DELAY_MS = 250;

exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            [{ language: "typescript" }, { language: "javascript" }, { language: "plaintext" }],
            {
                provideInlineCompletionItems: function (document, position) {
                    const line = document.getText().split("\n")[position.line] || "";
                    const prefix = line.slice(0, position.character);
                    const match = SUGGESTIONS.find((s) => prefix.endsWith(s.trigger));
                    if (match === undefined) return Promise.resolve([]);
                    return new Promise(function (resolve) {
                        setTimeout(function () {
                            resolve([new vscode.InlineCompletionItem(match.insertText)]);
                        }, RESPONSE_DELAY_MS);
                    });
                },
            },
        ),
    );
};

exports.deactivate = function deactivate() {};
