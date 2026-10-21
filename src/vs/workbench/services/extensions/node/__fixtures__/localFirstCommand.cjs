"use strict";

/**
 * Fixture for ExtensionHost.Commands.test.ts: local-first executeCommand.
 * Registers a command and immediately calls it itself: the command is in the local
 * Map, so it runs right in the subprocess without an RPC to the host. Sets tabSize=9.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.commands.registerCommand("test.localApply", function (n) {
            const editor = vscode.window.activeTextEditor;
            if (editor != null) editor.options = { tabSize: n };
            return n;
        }),
    );
    return vscode.commands.executeCommand("test.localApply", 9);
};
