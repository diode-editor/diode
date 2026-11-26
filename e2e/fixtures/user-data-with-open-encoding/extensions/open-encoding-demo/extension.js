const path = require("node:path");
const vscode = require("vscode");

exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand("openEncodingDemo.open", async () => {
            // latin.txt holds "Hellö Wörld" in Windows-1252: read as utf-8 the umlauts are replacement chars.
            const uri = vscode.Uri.file(path.join(context.extensionPath, "latin.txt"));
            const doc = await vscode.workspace.openTextDocument(uri, { encoding: "cp1252" });
            await vscode.window.showTextDocument(doc);
        }),
    );
};
