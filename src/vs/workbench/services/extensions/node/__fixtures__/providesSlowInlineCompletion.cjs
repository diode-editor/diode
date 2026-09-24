"use strict";

/**
 * Фикстура для extensionHost.inlineCompletion.test.ts: inline-completion-провайдер,
 * который отвечает не сразу (медленный бэкенд — тот случай, ради которого и
 * заведён `editor.inlineSuggest.requestTimeout`). Задержка заметно больше
 * «тесного» таймаута из теста и заметно меньше дефолтного хостового.
 */
const RESPONSE_DELAY_MS = 300;

exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            { language: "typescript" },
            {
                provideInlineCompletionItems: function () {
                    return new Promise(function (resolve) {
                        setTimeout(function () {
                            resolve([new vscode.InlineCompletionItem("onacci(n) {}")]);
                        }, RESPONSE_DELAY_MS);
                    });
                },
            },
        ),
    );
};
