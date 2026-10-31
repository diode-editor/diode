// `workspace.openTextDocument(untitled:…)` and friends: what an extension sees through the real RPC.
const vscode = require("vscode");

function describe(doc) {
    return {
        uri: doc.uri.toString(),
        isUntitled: doc.isUntitled,
        isDirty: doc.isDirty,
        isClosed: doc.isClosed,
        languageId: doc.languageId,
        encoding: doc.encoding,
        text: doc.getText(),
    };
}

function activate(context) {
    const register = (id, run) => context.subscriptions.push(vscode.commands.registerCommand(id, run));

    register("test.untitledUri.open", async (uri, options) => {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri), options);
        return describe(doc);
    });

    register("test.untitledUri.openFails", async (uri) => {
        try {
            await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
            return null;
        } catch (error) {
            return String(error.message);
        }
    });

    register("test.untitledUri.openEmpty", async (options) => describe(await vscode.workspace.openTextDocument(options)));

    // The same object stays with the extension: an encoding change must reach it.
    register("test.untitledUri.changeEncoding", async (encoding) => {
        const doc = await vscode.workspace.openTextDocument({ content: "Hello" });
        const before = doc.encoding;
        const again = await vscode.workspace.openTextDocument(doc.uri, { encoding });
        return { before, after: doc.encoding, same: again === doc };
    });

    register("test.untitledUri.vscodeOpen", async (uri) => {
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(uri));
        return describe(vscode.window.activeTextEditor.document);
    });

    register("test.untitledUri.saveShown", async (uri, show) => {
        const closed = [];
        const subscription = vscode.workspace.onDidCloseTextDocument((doc) => closed.push(doc));
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
        if (show) await vscode.window.showTextDocument(doc);
        const saved = await doc.save();
        subscription.dispose();
        return {
            saved,
            closedSameDocument: closed.includes(doc),
            isDirty: doc.isDirty,
            isClosed: doc.isClosed,
        };
    });

    register("test.untitledUri.activeUri", () => vscode.window.activeTextEditor?.document.uri.toString() ?? null);

    register("test.untitledUri.applyEditHeld", async (uri, text) => {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, new vscode.Position(0, 0), text);
        const applied = await vscode.workspace.applyEdit(edit);
        return { applied, ...describe(doc) };
    });

    register("test.untitledUri.createAndEdit", async (uri, text) => {
        const target = vscode.Uri.parse(uri);
        const edit = new vscode.WorkspaceEdit();
        edit.createFile(target, { ignoreIfExists: true });
        edit.replace(target, new vscode.Range(0, 0, 0, 0), text);
        const applied = await vscode.workspace.applyEdit(edit);
        return { applied, ...describe(await vscode.workspace.openTextDocument(target)) };
    });

    register("test.untitledUri.saveAll", async (includeUntitled) => vscode.workspace.saveAll(includeUntitled));
}

module.exports = { activate };
