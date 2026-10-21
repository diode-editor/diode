"use strict";

// WP7 fixture: mirrors the stock `EditorConfig.generate` command on top of
// the new `workspace.fs` API: checks existence via fs.stat and writes
// `.editorconfig` to the workspace root via fs.writeFile + Uri.joinPath.
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.commands.registerCommand("EditorConfig.generate", async function () {
            const root = vscode.workspace.workspaceFolders[0].uri;
            const target = vscode.Uri.joinPath(root, ".editorconfig");
            try {
                await vscode.workspace.fs.stat(target);
                return "exists";
            } catch (err) {
                // FileNotFound: the file does not exist yet, continue generating.
            }
            const content = "root = true\n\n[*]\nindent_style = space\nindent_size = 4\n";
            await vscode.workspace.fs.writeFile(target, Buffer.from(content, "utf8"));
            return "generated";
        }),
    );
};

exports.deactivate = function deactivate() {};
