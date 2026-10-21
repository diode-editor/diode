"use strict";

/**
 * Fixture for ExtensionHost.Completion.test.ts.
 * Registers a completion provider for the editorconfig language (a selector with a pattern)
 * and the `editorconfig._triggerSuggestAfterDelay` command (mirroring the real extension's
 * command). The provider returns two properties; the first has a `command` whose
 * handler sets the active editor's tabSize=6 as an observable signal
 * that item.command made it through the commands bridge.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.commands.registerCommand("editorconfig._triggerSuggestAfterDelay", function () {
            const editor = vscode.window.activeTextEditor;
            if (editor != null) editor.options = { tabSize: 6 };
            return "retriggered";
        }),
    );

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: "editorconfig", pattern: "**/.editorconfig" },
            {
                provideCompletionItems: function () {
                    const style = new vscode.CompletionItem("indent_style", vscode.CompletionItemKind.Property);
                    style.detail = "EditorConfig";
                    style.command = { command: "editorconfig._triggerSuggestAfterDelay", title: "" };
                    const size = new vscode.CompletionItem("indent_size", vscode.CompletionItemKind.Property);
                    return [style, size];
                },
            },
        ),
    );
};
