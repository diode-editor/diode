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
        // Upstream's grammar, parsed in the core (#1031): a variable transform and a nested placeholder.
        vscode.commands.registerTextEditorCommand("insertSnippetDemo.upcase", (editor) =>
            editor.insertSnippet(new vscode.SnippetString("${TM_SELECTED_TEXT/(.*)/${1:/upcase}/} ${1:${2:nested} placeholder}")),
        ),
        // A snippet session (#1032): a tab stop with a mirror, then the final one.
        vscode.commands.registerTextEditorCommand("insertSnippetDemo.assign", (editor) =>
            editor.insertSnippet(new vscode.SnippetString("${1:name} = $1;$0")),
        ),
        // A choice and a transformed mirror (#1033): the popup offers get/set, the field name loses its underscore.
        vscode.commands.registerTextEditorCommand("insertSnippetDemo.accessor", (editor) =>
            editor.insertSnippet(new vscode.SnippetString("${1|get,set|} ${2:_name}() { return this.${2/^_(.*)/$1/}; }$0")),
        ),
        vscode.commands.registerCommand("insertSnippetDemo.tab", () => vscode.commands.executeCommand("tab")),
        vscode.commands.registerCommand("insertSnippetDemo.lineBelow", () =>
            vscode.commands.executeCommand("editor.action.insertLineAfter"),
        ),
    );
};
