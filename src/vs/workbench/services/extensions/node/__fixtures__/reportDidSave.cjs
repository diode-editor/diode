"use strict";

/**
 * did-save fixture: on onDidSaveTextDocument sets the active editor's tabSize
 * to the marker 42. Checks that the post-save notify reaches the extension
 * (and that the subscription gates sending: without onWillSave no will-save RPC is made).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(function () {
            const editor = vscode.window.activeTextEditor;
            if (editor != null) editor.options = { tabSize: 42 };
        }),
    );
};
