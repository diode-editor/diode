"use strict";

/**
 * Fixture: throws from a timer, outside any promise (#861, Todo Tree 0.0.215's `ThemeColor(...)`
 * without `new`). The `test.alive` command answers only while the subprocess lives on.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(vscode.commands.registerCommand("test.alive", () => "alive"));
    setTimeout(() => {
        throw new Error("boom");
    }, 0);
};
exports.deactivate = function deactivate() {};
