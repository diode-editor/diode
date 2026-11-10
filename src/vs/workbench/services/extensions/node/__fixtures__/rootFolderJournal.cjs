"use strict";

/**
 * Fixture for extensionHost.onDidChangeWorkspaceFolders.test.ts. Every subprocess appends
 * to one journal in `globalStorageUri` (shared by all restarts): the folders it saw in
 * `activate()`, whether the subscription returned a disposable, and every fire of
 * `onDidChangeWorkspaceFolders`. A synchronous append survives the subprocess's shutdown.
 */
const fs = require("node:fs");
const path = require("node:path");

exports.activate = function activate(context) {
    const vscode = require("vscode");
    const dir = context.globalStorageUri.fsPath;
    fs.mkdirSync(dir, { recursive: true });
    const journal = path.join(dir, "journal.txt");
    const write = (line) => fs.appendFileSync(journal, line + "\n");
    const folders = () => (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath).join(",");

    write("activate " + process.pid + " " + folders());
    const subscription = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
        write("event " + process.pid + " " + event.added.length + "+" + event.removed.length);
    });
    write("disposable " + process.pid + " " + (typeof subscription.dispose === "function"));
    context.subscriptions.push(
        subscription,
        vscode.commands.registerCommand("test.replaceFolder", (folderPath) =>
            vscode.workspace.updateWorkspaceFolders(0, 1, { uri: vscode.Uri.file(folderPath) }),
        ),
    );
};
