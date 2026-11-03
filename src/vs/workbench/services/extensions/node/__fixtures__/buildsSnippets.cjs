"use strict";

/**
 * Fixture for extensionHost.snippetBuilders.test.ts (#1030). The other ways a `SnippetString` reaches the buffer
 * besides `insertSnippet`: a completion item, an inline completion item and a `SnippetTextEdit`, each built with
 * the builders around text that has `}` and `\` in it.
 */
const vscode = require("vscode");

function functionBody() {
    return new vscode.SnippetString().appendText("f() {").appendTabstop(0).appendText("}");
}

function windowsPath() {
    return new vscode.SnippetString().appendText("C:\\Users\\").appendPlaceholder("name");
}

exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: "plaintext" },
            {
                provideCompletionItems() {
                    const body = new vscode.CompletionItem("body");
                    body.insertText = functionBody();
                    const path = new vscode.CompletionItem("path");
                    path.insertText = windowsPath();
                    return [body, path];
                },
            },
        ),
        vscode.languages.registerInlineCompletionItemProvider(
            { language: "plaintext" },
            {
                provideInlineCompletionItems() {
                    return [new vscode.InlineCompletionItem(functionBody())];
                },
            },
        ),
        vscode.commands.registerCommand("test.snippets.applyEdit", () => {
            const document = vscode.window.activeTextEditor.document;
            const edit = new vscode.WorkspaceEdit();
            edit.set(document.uri, [new vscode.SnippetTextEdit(new vscode.Range(0, 0, 0, 0), functionBody())]);
            return vscode.workspace.applyEdit(edit);
        }),
    );
};
