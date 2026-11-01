"use strict";

const vscode = require("vscode");

exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand("insertSnippetDemo.hang", (editor) => {
            void editor.insertSnippet(new vscode.SnippetString("\n    $0\n"));
        }),
        // The core commands yzhang.markdown-all-in-one calls from its own key bindings.
        vscode.commands.registerCommand("insertSnippetDemo.link", () =>
            vscode.commands.executeCommand("editor.action.insertSnippet", { snippet: "[$TM_SELECTED_TEXT$0](url)" }),
        ),
        vscode.commands.registerCommand("insertSnippetDemo.tab", () => vscode.commands.executeCommand("tab")),
        vscode.commands.registerCommand("insertSnippetDemo.lineBelow", () =>
            vscode.commands.executeCommand("editor.action.insertLineAfter"),
        ),
    );
};
