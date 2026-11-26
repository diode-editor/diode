"use strict";

/** Each command reveals line 201 of the active editor (0-based 200) with one `TextEditorRevealType`. */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    function register(command, type) {
        return vscode.commands.registerCommand(command, function () {
            vscode.window.activeTextEditor?.revealRange(new vscode.Range(200, 0, 200, 0), type);
        });
    }

    context.subscriptions.push(
        register("revealRange.default", vscode.TextEditorRevealType.Default),
        register("revealRange.inCenter", vscode.TextEditorRevealType.InCenter),
        register("revealRange.inCenterIfOutside", vscode.TextEditorRevealType.InCenterIfOutsideViewport),
        register("revealRange.atTop", vscode.TextEditorRevealType.AtTop),
    );
};
