"use strict";

/**
 * Fixture for extensionHost.findFilesExclude.test.ts. `test.findFiles` runs `workspace.findFiles(include)` without
 * an `exclude` (`files.exclude` applies) or with `exclude: null` (nothing applies) and returns sorted relative paths.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.commands.registerCommand("test.findFiles", async (include, nullExclude) => {
            const uris = nullExclude === true
                ? await vscode.workspace.findFiles(include, null)
                : await vscode.workspace.findFiles(include);
            return uris.map((uri) => vscode.workspace.asRelativePath(uri)).sort();
        }),
    );
};
