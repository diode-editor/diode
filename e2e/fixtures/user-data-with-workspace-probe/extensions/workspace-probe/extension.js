"use strict";

/**
 * Reads `vscode.workspace` ONCE, in `activate()`, like real extensions (a language client
 * hands folders to the server in `initialize`): a new value in the bar means the extension host
 * process was restarted. The text is short: an item longer than ~24 characters is truncated.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    item.name = "Workspace Probe";
    item.text = vscode.workspace.name;
    item.show();
    context.subscriptions.push(item);
};

exports.deactivate = function deactivate() {};
