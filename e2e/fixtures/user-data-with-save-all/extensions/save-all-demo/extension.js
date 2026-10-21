"use strict";

/** `workspace.saveAll` — как golang.go перед `gopls.tidy` и vulncheck. */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const result = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    context.subscriptions.push(
        result,
        vscode.commands.registerCommand("saveAllDemo.run", async () => {
            const saved = await vscode.workspace.saveAll(false);
            result.text = `saveAll: ${String(saved)}`;
            result.show();
        }),
    );
};
