"use strict";

/** The "Shell env demo ready" item signals the scenario that the collection is already written. */
exports.activate = function activate(context) {
    // Only at shell integration: the process starts without it, the script prepends it after `~/.bashrc`.
    context.environmentVariableCollection.prepend("PATH", "/opt/shell-tools:", {
        applyAtProcessCreation: false,
        applyAtShellIntegration: true,
    });

    const vscode = require("vscode");
    const ready = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    ready.text = "Shell env demo ready";
    ready.show();
    context.subscriptions.push(ready);
};
