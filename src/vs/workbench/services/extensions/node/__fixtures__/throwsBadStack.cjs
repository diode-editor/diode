"use strict";

/**
 * Fixture (#861): throws an Error whose `stack` getter itself throws, from a timer.
 * `test.alive` answers only while the subprocess lives on.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(vscode.commands.registerCommand("test.alive", () => "alive"));
    const thrown = new Error("bad-stack");
    Object.defineProperty(thrown, "stack", {
        get() {
            throw new Error("stack getter throws");
        },
    });
    setTimeout(() => {
        throw thrown;
    }, 0);
};
exports.deactivate = function deactivate() {};
