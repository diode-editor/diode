"use strict";

/**
 * Fixture for extensionHost.statusBar.test.ts: the extension puts an item in the
 * status bar on activation and edits it via commands it registers itself.
 * This checks the whole round trip: `createStatusBarItem` → bar → click → extension
 * command → text edit → back to the bar.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    item.name = "Status Bar Demo";
    item.text = "Demo";
    item.command = "test.statusBar.click";
    item.show();

    let clicks = 0;
    context.subscriptions.push(
        vscode.commands.registerCommand("test.statusBar.click", function () {
            clicks += 1;
            item.text = "Demo · clicked " + clicks;
            return clicks;
        }),
        vscode.commands.registerCommand("test.statusBar.setText", function (text) {
            item.text = text;
        }),
        vscode.commands.registerCommand("test.statusBar.hide", function () {
            item.hide();
        }),
        vscode.commands.registerCommand("test.statusBar.show", function () {
            item.show();
        }),
        vscode.commands.registerCommand("test.statusBar.dispose", function () {
            item.dispose();
        }),
        // Kills its own process to model an extension crash. The exit is deferred
        // by a tick so the RPC reply reaches the caller.
        vscode.commands.registerCommand("test.statusBar.kill", function () {
            setTimeout(function () {
                process.exit(1);
            }, 10);
            return "dying";
        }),
        vscode.commands.registerCommand("test.statusBar.createLeft", function () {
            const left = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
            left.text = "L-high";
            left.show();
        }),
        item,
    );
};
