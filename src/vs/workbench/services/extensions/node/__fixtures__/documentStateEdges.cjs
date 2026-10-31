// Edges of the document contract: what an extension observes around line endings, deletes and reloads.
const vscode = require("vscode");

const stateOf = (doc) => ({ text: doc.getText(), isDirty: doc.isDirty, eol: doc.eol, version: doc.version });

function activate(context) {
    const register = (id, run) => context.subscriptions.push(vscode.commands.registerCommand(id, run));
    const insertAtStart = (uri, text) => {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(uri, new vscode.Position(0, 0), text);
        return vscode.workspace.applyEdit(edit);
    };
    const remove = (uri) => {
        const edit = new vscode.WorkspaceEdit();
        edit.deleteFile(uri);
        return vscode.workspace.applyEdit(edit);
    };

    register("test.edges.setEolViaEditor", async () => {
        const editor = vscode.window.activeTextEditor;
        const before = editor.document.version;
        await editor.edit((builder) => builder.setEndOfLine(vscode.EndOfLine.CRLF));
        return {
            ...stateOf(editor.document),
            before,
            offsetOfSecondLine: editor.document.offsetAt(new vscode.Position(1, 0)),
        };
    });

    register("test.edges.setEolViaApplyEdit", async () => {
        const editor = vscode.window.activeTextEditor;
        const edit = new vscode.WorkspaceEdit();
        edit.set(editor.document.uri, [vscode.TextEdit.setEndOfLine(vscode.EndOfLine.CRLF)]);
        await vscode.workspace.applyEdit(edit);
        return stateOf(editor.document);
    });

    register("test.edges.changeEvents", async () => {
        const editor = vscode.window.activeTextEditor;
        const seen = [];
        const listener = vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document === editor.document) {
                seen.push({ changes: event.contentChanges.length, isDirty: event.document.isDirty, eol: event.document.eol });
            }
        });
        await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), "1"));
        const afterEdit = seen.length;
        await editor.edit((builder) => builder.setEndOfLine(vscode.EndOfLine.CRLF));
        const afterEol = seen.length;
        await editor.document.save();
        const afterSave = seen.length;
        listener.dispose();
        return { afterEdit, afterEol, afterSave, last: seen[seen.length - 1] };
    });

    register("test.edges.editDeleteOpened", async (filePath) => {
        const uri = vscode.Uri.file(filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        await insertAtStart(uri, "X");
        const deleted = await remove(uri);
        const isDirty = doc.isDirty;
        await vscode.workspace.saveAll(false);
        return { deleted, isDirty };
    });

    register("test.edges.deleteDirtyTab", async () => {
        const editor = vscode.window.activeTextEditor;
        await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), "X"));
        const deleted = await remove(editor.document.uri);
        await vscode.workspace.saveAll(false);
        return { deleted };
    });

    register("test.edges.editDeleteSameBatch", async (filePath) => {
        const uri = vscode.Uri.file(filePath);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(uri, new vscode.Position(0, 0), "X");
        edit.deleteFile(uri);
        const applied = await vscode.workspace.applyEdit(edit);
        await vscode.workspace.saveAll(false);
        return { applied };
    });

    let held;
    register("test.edges.hold", async (filePath) => {
        held = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        return stateOf(held);
    });
    register("test.edges.readHeld", () => stateOf(held));

    register("test.edges.mergedUndoStops", async () => {
        const editor = vscode.window.activeTextEditor;
        const insert = (text) => (builder) => builder.insert(new vscode.Position(0, 0), text);
        await editor.edit(insert("1"), { undoStopBefore: true, undoStopAfter: false });
        await editor.edit(insert("2"), { undoStopBefore: false, undoStopAfter: true });
    });

    let rememberedEditor;
    register("test.edges.rememberEditor", async (filePath) => {
        // Opened before the tab, so the document stays live: only the editor goes away with the tab.
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        rememberedEditor = await vscode.window.showTextDocument(doc);
    });
    register("test.edges.editRememberedEditor", async () => {
        try {
            return { resolved: await rememberedEditor.edit((builder) => builder.insert(new vscode.Position(0, 0), "x")) };
        } catch (error) {
            return { rejected: error.message };
        }
    });

    register("test.edges.growPastManyLines", async (lines) => {
        const editor = vscode.window.activeTextEditor;
        const applied = await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), "line\n".repeat(lines)));
        const state = { applied, lineCount: editor.document.lineCount, isDirty: editor.document.isDirty, version: editor.document.version };
        const next = await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), "Z"));
        return { ...state, next };
    });
}

module.exports = { activate };
