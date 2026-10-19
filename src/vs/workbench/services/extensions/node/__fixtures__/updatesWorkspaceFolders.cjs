"use strict";

/**
 * Фикстура для extensionHost.updateWorkspaceFolders.test.ts —
 * `workspace.updateWorkspaceFolders` через НАСТОЯЩИЙ субпроцесс. Форма вызова —
 * как у golang.go («Go: Add Package to Workspace»): добавить папку в конец,
 * `deleteCount` = null. Команда возвращает то, что вернул API.
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
