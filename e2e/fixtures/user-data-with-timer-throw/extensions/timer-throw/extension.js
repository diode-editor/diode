"use strict";

/**
 * Throws from a timer (#861: Todo Tree 0.0.215's `ThemeColor(...)` without `new`), and a second later
 * shows a status bar item: it appears only if the extension host subprocess survived the throw.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    setTimeout(() => {
        throw new Error("boom");
    }, 0);
    const timer = setTimeout(() => {
        const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        item.text = "Survived the throw";
        item.show();
        context.subscriptions.push(item);
    }, 1000);
    context.subscriptions.push({ dispose: () => clearTimeout(timer) });
};

exports.deactivate = function deactivate() {};
