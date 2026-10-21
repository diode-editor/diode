"use strict";

/**
 * Fixture for ExtensionHost.Commands.test.ts, the host → subprocess direction.
 * Registers the `test.applyTab` command; when the core executes it (through the proxy in
 * the host CommandRegistry), the handler sets the active editor's tabSize from the argument.
 * The signal goes out through editor.options (the established fixture convention).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.commands.registerCommand("test.applyTab", function (n) {
            const editor = vscode.window.activeTextEditor;
            if (editor == null) return "no-editor";
            editor.options = { tabSize: n };
            return "applied:" + n;
        }),
    );
};
