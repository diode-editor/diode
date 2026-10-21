"use strict";

/**
 * Fixture for extensionHost.updateWorkspaceFolders.test.ts:
 * `workspace.updateWorkspaceFolders` through a REAL subprocess. The call shape
 * matches golang.go ("Go: Add Package to Workspace"): append a folder at the end,
 * `deleteCount` = null. The command returns whatever the API returned.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.commands.registerCommand("test.addFolder", function (folderPath) {
            const folders = vscode.workspace.workspaceFolders;
            return vscode.workspace.updateWorkspaceFolders(folders ? folders.length : 0, null, {
                uri: vscode.Uri.file(folderPath),
            });
        }),
        vscode.commands.registerCommand("test.replaceFolder", function (folderPath) {
            return vscode.workspace.updateWorkspaceFolders(0, 1, { uri: vscode.Uri.file(folderPath) });
        }),
    );
};
