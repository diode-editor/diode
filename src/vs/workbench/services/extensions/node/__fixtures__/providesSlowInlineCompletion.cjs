"use strict";

/**
 * Fixture for extensionHost.inlineCompletion.test.ts: an inline completion provider
 * that answers with a delay (a slow backend, the very case
 * `editor.inlineSuggest.requestTimeout` exists for). The delay is well above
 * the test's "tight" timeout and well below the host's default one.
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
