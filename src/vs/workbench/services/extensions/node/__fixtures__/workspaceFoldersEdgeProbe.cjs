"use strict";

/**
 * Fixture for extensionHost.onDidChangeWorkspaceFolders.edges.test.ts. Like workspaceFoldersProbe.cjs, every
 * subprocess appends to one journal in `globalStorageUri`: folders seen in `activate()` and every fire of
 * `onDidChangeWorkspaceFolders`. Commands expose `updateWorkspaceFolders` with arbitrary arguments and the
 * `Event` contract of the subscription (thisArgs, disposables array).
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
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders((event) => {
            write("event " + process.pid + " " + event.added.length + "+" + event.removed.length);
        }),
        vscode.commands.registerCommand("test.edge.update", (index, deleteCount, paths) =>
            vscode.workspace.updateWorkspaceFolders(
                index,
                deleteCount,
                ...paths.map((p) => ({ uri: vscode.Uri.file(p) })),
            ),
        ),
        vscode.commands.registerCommand("test.edge.folders", () => folders()),
        vscode.commands.registerCommand("test.edge.subscribeContract", () => {
            const bag = [];
            const self = { tag: "self" };
            const d = vscode.workspace.onDidChangeWorkspaceFolders(
                function () {
                    write("event-this " + process.pid + " " + (this === self));
                },
                self,
                bag,
            );
            const pushed = bag.length === 1 && bag[0] === d;
            d.dispose();
            d.dispose();
            return { pushed, disposeType: typeof d.dispose };
        }),
    );
};
