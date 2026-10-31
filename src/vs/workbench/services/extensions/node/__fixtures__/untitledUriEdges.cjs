// Edges of untitled documents by uri: what an extension sees through the real RPC.
const vscode = require("vscode");

const held = new Map();

const openDocument = (uri) => (uri ? vscode.workspace.openTextDocument(vscode.Uri.parse(uri)) : vscode.workspace.openTextDocument());

function activate(context) {
    const register = (id, run) => context.subscriptions.push(vscode.commands.registerCommand(id, run));

    // The same document in the first and the second group, by `showTextDocument`.
    register("test.untitledUriEdges.showInTwoGroups", async (uri) => {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
        const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Two });
        return {
            returnedColumn: editor.viewColumn,
            tabsPerGroup: vscode.window.tabGroups.all.map((group) => group.tabs.length),
            visibleColumns: vscode.window.visibleTextEditors
                .filter((visible) => visible.document === doc)
                .map((visible) => visible.viewColumn),
        };
    });

    register("test.untitledUriEdges.dirtyAfterShow", async () => {
        const doc = await vscode.workspace.openTextDocument();
        const opened = doc.isDirty;
        await vscode.window.showTextDocument(doc);
        return { opened, shown: doc.isDirty };
    });

    register("test.untitledUriEdges.dirtyAfterEmptying", async (uri) => {
        const doc = await openDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), "x"));
        const typed = doc.isDirty;
        await editor.edit((edit) => edit.delete(new vscode.Range(0, 0, 0, 1)));
        return { typed, emptied: doc.isDirty };
    });

    register("test.untitledUriEdges.deleteIgnoringMissing", async (uri, open) => {
        const target = vscode.Uri.parse(uri);
        if (open) await vscode.workspace.openTextDocument(target);
        const edit = new vscode.WorkspaceEdit();
        edit.deleteFile(target, { ignoreIfNotExists: true });
        return vscode.workspace.applyEdit(edit);
    });

    register("test.untitledUriEdges.openHeld", async (uri) => {
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(uri));
        held.set(uri, vscode.window.activeTextEditor.document);
    });

    register("test.untitledUriEdges.heldIsClosed", (uri) => held.get(uri).isClosed);

    register("test.untitledUriEdges.reopenHeld", async (uri) => {
        const old = held.get(uri);
        const fresh = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
        return { sameObject: fresh === old, oldIsClosed: old.isClosed };
    });
}

module.exports = { activate };
