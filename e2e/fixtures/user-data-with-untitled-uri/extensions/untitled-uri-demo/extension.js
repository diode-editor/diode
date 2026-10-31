const vscode = require("vscode");

exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand("untitledUriDemo.open", async () => {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse("untitled:new.txt"));
            const edit = new vscode.WorkspaceEdit();
            edit.insert(doc.uri, new vscode.Position(0, 0), "text from the extension\n");
            await vscode.workspace.applyEdit(edit);
            await vscode.window.showTextDocument(doc);
        }),
    );
};
