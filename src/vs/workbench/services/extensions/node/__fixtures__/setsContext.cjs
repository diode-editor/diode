"use strict";

/**
 * Fixture for extensionHost.setContext.test.ts. Publishes its own when key exactly
 * the way third-party extensions do: `executeCommand("setContext", key,
 * value)` from activate() and from its own command. The key is dotted (`publisher.thing`):
 * extensions practically never use any other kind of name.
 */
exports.activate = async function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.commands.registerCommand("test.setctx.arm", function () {
            return vscode.commands.executeCommand("setContext", "testExt.armed", true);
        }),
        vscode.commands.registerCommand("test.setctx.disarm", function () {
            return vscode.commands.executeCommand("setContext", "testExt.armed", false);
        }),
        vscode.commands.registerCommand("test.setctx.setMode", function (mode) {
            return vscode.commands.executeCommand("setContext", "testExt.mode", mode);
        }),
    );

    // The activation-time call: this is exactly where Supermaven sends `setContext` from.
    await vscode.commands.executeCommand("setContext", "testExt.activated", true);
};
