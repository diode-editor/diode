"use strict";

/**
 * Fixture for extensionHost.fileWatcherSubprocess.test.ts.
 * Sets up `workspace.createFileSystemWatcher` the same way the
 * built-in git does: a recursive watcher over the working tree plus a non-recursive
 * watcher on a single directory via `RelativePattern`.
 *
 * Observed events are collected into an array; the test fetches them with a host command
 * to check the whole path: core → host → subprocess → extension.
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
        true, // ignoreChangeEvents: checks that the flag reaches the core
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
