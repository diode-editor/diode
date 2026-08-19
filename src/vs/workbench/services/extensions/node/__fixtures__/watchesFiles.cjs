"use strict";

/**
 * Фикстура для extensionHost.fileWatcherSubprocess.test.ts.
 * Заводит `workspace.createFileSystemWatcher` — тем же способом, что и
 * встроенный git: рекурсивный watcher рабочего дерева плюс нерекурсивный
 * watcher одного каталога через `RelativePattern`.
 *
 * Увиденные события копятся в массив; тест забирает их хостовой командой,
 * чтобы проверить весь путь: ядро → host → subprocess → расширение.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const seen = [];
    const record = (kind) => (uri) => seen.push(kind + " " + uri.fsPath);

    const tree = vscode.workspace.createFileSystemWatcher("**/*.ts");
    tree.onDidCreate(record("created"));
    tree.onDidChange(record("changed"));
    tree.onDidDelete(record("deleted"));
    context.subscriptions.push(tree);

    const folder = vscode.workspace.workspaceFolders[0];
    const shallow = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, "*.md"),
        false,
        true, // ignoreChangeEvents — проверяем, что флаг доезжает до ядра
        false,
    );
    shallow.onDidCreate(record("md-created"));
    shallow.onDidChange(record("md-changed"));
    context.subscriptions.push(shallow);

    context.subscriptions.push(
        vscode.commands.registerCommand("demo.watched", function () {
            return seen.slice();
        }),
    );
};
