"use strict";

/**
 * Fixture for ExtensionHost.Commands.test.ts: rejection of an unknown command.
 * `does.not.exist` is neither local nor in the host CommandRegistry, so
 * executeCommand rejects. We catch the rejection and signal with marker tabSize=3.
 */
exports.activate = function activate(_context) {
    const vscode = require("vscode");
    return vscode.commands.executeCommand("does.not.exist").then(
        function () {
            // must not happen
        },
        function () {
            const editor = vscode.window.activeTextEditor;
            if (editor != null) editor.options = { tabSize: 3 };
        },
    );
};
