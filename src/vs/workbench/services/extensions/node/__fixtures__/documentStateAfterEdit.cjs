// What an extension sees right after an edit resolves: the document it holds must already reflect it.
const vscode = require("vscode");

function stateOf(doc, applied) {
    return { applied, text: doc.getText(), isDirty: doc.isDirty, eol: doc.eol, version: doc.version };
}

function activate(context) {
    const register = (id, run) => context.subscriptions.push(vscode.commands.registerCommand(id, run));

    register("test.state.editorEdit", async (text) => {
        const editor = vscode.window.activeTextEditor;
        const applied = await editor.edit((builder) => {
            builder.insert(new vscode.Position(0, 0), text);
        });
        return stateOf(editor.document, applied);
    });

    register("test.state.parallelEdits", async () => {
        const editor = vscode.window.activeTextEditor;
        const first = editor.edit((builder) => builder.insert(new vscode.Position(0, 0), "1"));
        const second = editor.edit((builder) => builder.insert(new vscode.Position(0, 0), "2"));
        return { first: await first, second: await second, text: editor.document.getText() };
    });

    register("test.state.setEol", async () => {
        const editor = vscode.window.activeTextEditor;
        const applied = await editor.edit((builder) => builder.setEndOfLine(vscode.EndOfLine.CRLF));
        return stateOf(editor.document, applied);
    });

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand("test.state.insertViaCommand", async (_editor, edit, text) => {
            edit.insert(new vscode.Position(0, 0), text);
            // Upstream finalizes the builder when the callback returns: an async tail doesn't hold the edit back.
            await new Promise((resolve) => setTimeout(resolve, 10));
            try {
                edit.insert(new vscode.Position(0, 0), "late");
            } catch {
                context.globalState.update("lateThrew", true);
            }
        }),
    );

    let opened;
    register("test.state.open", async (filePath) => {
        opened = await vscode.workspace.openTextDocument(filePath);
        const listed = vscode.workspace.textDocuments.some((doc) => doc === opened);
        return { ...stateOf(opened, true), listed };
    });
    register("test.state.applyEditToOpened", async (text) => {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(opened.uri, new vscode.Position(0, 0), text);
        return stateOf(opened, await vscode.workspace.applyEdit(edit));
    });
    register("test.state.applyEolToOpened", async () => {
        const edit = new vscode.WorkspaceEdit();
        edit.set(opened.uri, [vscode.TextEdit.setEndOfLine(vscode.EndOfLine.CRLF)]);
        return stateOf(opened, await vscode.workspace.applyEdit(edit));
    });
    register("test.state.saveOpened", async () => {
        const saved = await opened.save();
        return stateOf(opened, saved);
    });
    register("test.state.showOpened", async () => {
        await vscode.window.showTextDocument(opened);
    });
    register("test.state.renameDirty", async (filePath, target, text) => {
        const from = vscode.Uri.file(filePath);
        const to = vscode.Uri.file(target);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(from, new vscode.Position(0, 0), "BEFORE");
        edit.renameFile(from, to);
        edit.insert(to, new vscode.Position(0, 0), text);
        const applied = await vscode.workspace.applyEdit(edit);
        return stateOf(await vscode.workspace.openTextDocument(to), applied);
    });
    register("test.state.saveAll", () => vscode.workspace.saveAll(false));
}

module.exports = { activate };
