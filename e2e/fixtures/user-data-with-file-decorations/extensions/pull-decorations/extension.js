"use strict";

/**
 * A pull-only file decoration provider: no `onDidChangeFileDecorations`, so it never tells anyone about a file. A
 * `*.pull` file gets the red badge `P`, which propagates to its folders; everything else gets nothing.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider({
            provideFileDecoration: function (uri) {
                if (!uri.path.endsWith(".pull")) return undefined;
                const decoration = new vscode.FileDecoration("P", "pulled", new vscode.ThemeColor("charts.red"));
                decoration.propagate = true;
                return decoration;
            },
        }),
    );
};
