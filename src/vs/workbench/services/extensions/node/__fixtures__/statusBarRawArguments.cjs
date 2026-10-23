"use strict";

/**
 * Fixture for extensionHost.ipcFallback.test.ts: the extension hands the host values the IPC
 * structured clone rejects — a function inside the status bar command arguments, next to a
 * `vscode.Uri` and plain data. Its command reports what came back on a click.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    item.text = "Raw";
    item.command = {
        title: "Raw",
        command: "test.rawArgs.click",
        arguments: [vscode.Uri.file("/tmp/raw.ts"), () => "a function", { nested: { keep: 2, fn: () => 1 } }],
    };
    item.show();

    const describe = (value) => {
        if (value === null) return "null";
        if (typeof value !== "object") return typeof value;
        return Object.keys(value).sort().join(",");
    };
    context.subscriptions.push(
        vscode.commands.registerCommand("test.rawArgs.click", function () {
            item.text = "clicked:" + Array.from(arguments).map(describe).join("|");
        }),
        item,
    );
};
