// `workspace.openTextDocument(file, { encoding })` on the live model: what an extension sees through the real RPC.
const vscode = require("vscode");

function describe(doc) {
    return { encoding: doc.encoding, isDirty: doc.isDirty, text: doc.getText() };
}

function activate(context) {
    const register = (id, run) => context.subscriptions.push(vscode.commands.registerCommand(id, run));
    const open = (path, encoding) =>
        vscode.workspace.openTextDocument(vscode.Uri.file(path), encoding === undefined ? undefined : { encoding });

    register("test.openWithEncoding.open", async (path, encoding) => describe(await open(path, encoding)));

    register("test.openWithEncoding.show", async (path, encoding) => {
        await vscode.window.showTextDocument(await open(path, encoding));
    });

    // Upstream `encoding: openTextDocument`: the same object, and a change event for the encoding alone.
    register("test.openWithEncoding.switch", async (path, first, second) => {
        const doc = await open(path, first);
        const before = doc.encoding;
        let changed = 0;
        const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document === doc) changed++;
        });
        const again = await open(path, second);
        subscription.dispose();
        return { before, after: doc.encoding, same: again === doc, changed };
    });

    register("test.openWithEncoding.concurrent", async (path, encoding) => {
        const [plain, encoded] = await Promise.all([open(path), open(path, encoding)]);
        return { same: plain === encoded, plain: plain.encoding, encoded: encoded.encoding };
    });

    register("test.openWithEncoding.editThenReopen", async (path, first, second) => {
        const doc = await open(path, first);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, new vscode.Position(0, 0), "Hello World");
        await vscode.workspace.applyEdit(edit);
        try {
            await open(path, second);
            return { isDirty: doc.isDirty, error: null };
        } catch (error) {
            return { isDirty: doc.isDirty, error: String(error.message) };
        }
    });

    // Upstream `encoding: save text document with a different encoding`.
    register("test.openWithEncoding.rewriteAndReopen", async (path, encoding) => {
        const uri = vscode.Uri.file(path);
        const text = (await vscode.workspace.openTextDocument(uri)).getText();
        await vscode.workspace.fs.writeFile(uri, await vscode.workspace.encode(text, { encoding }));
        const doc = await vscode.workspace.openTextDocument(uri, { encoding });
        return { ...describe(doc), original: text };
    });
}

module.exports = { activate };
