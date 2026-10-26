"use strict";

/**
 * Fixture (#861): throws an object without a prototype from a timer — `String()` cannot convert it.
 * `test.alive` answers only while the subprocess lives on.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(vscode.commands.registerCommand("test.alive", () => "alive"));
    const thrown = Object.create(null);
    thrown.marker = "null-proto";
    setTimeout(() => {
        throw thrown;
    }, 0);
};
exports.deactivate = function deactivate() {};
