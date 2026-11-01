"use strict";

const vscode = require("vscode");

exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand("insertSnippetDemo.hang", (editor) => {
            void editor.insertSnippet(new vscode.SnippetString("\n    $0\n"));
        }),
    );
};
