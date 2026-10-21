"use strict";

/**
 * Fixture for extensionHost.inlineCompletion.test.ts. Registers an
 * inline completion provider for typescript that returns two items:
 * multi-line plain text (a function body) and a SnippetString with range/filterText
 * (checks placeholder stripping and that the fields travel over the wire).
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
