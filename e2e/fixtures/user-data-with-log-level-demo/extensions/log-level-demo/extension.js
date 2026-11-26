"use strict";

const NAMES = ["Off", "Trace", "Debug", "Info", "Warning", "Error"];

/** `env.logLevel` and how many `env.onDidChangeLogLevel` events arrived, always visible in the status bar. */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    item.name = "Log Level Demo";
    let changes = 0;
    const render = () => {
        item.text = "log: " + NAMES[vscode.env.logLevel] + " · changes " + changes;
    };
    render();
    item.show();

    context.subscriptions.push(
        item,
        vscode.env.onDidChangeLogLevel(() => {
            changes += 1;
            render();
        }),
    );
};
