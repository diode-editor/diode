"use strict";

exports.activate = function activate(context) {
    const vscode = require("vscode");
    const result = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    result.text = "menu:-";
    result.show();
    context.subscriptions.push(
        result,
        vscode.commands.registerCommand("ungroupedMenuDemo.nav", () => {
            result.text = "menu:nav";
        }),
        vscode.commands.registerCommand("ungroupedMenuDemo.ast", () => {
            result.text = "menu:ast";
        }),
    );
};

exports.deactivate = function deactivate() {};
