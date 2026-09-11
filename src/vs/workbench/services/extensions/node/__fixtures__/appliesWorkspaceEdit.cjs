"use strict";

/**
 * Фикстура workspace.applyEdit (#196): команды строят WorkspaceEdit и применяют
 * его через vscode.workspace.applyEdit — тот же путь, которым пойдут правки
 * code actions и server-side workspace/applyEdit стокового vscode-languageclient.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    // Заменяет [0:0..0:5] активного документа на "HELLO".
    context.subscriptions.push(
        vscode.commands.registerCommand("test.applyReplaceActive", function () {
            const editor = vscode.window.activeTextEditor;
            if (editor == null) return null;
            const edit = new vscode.WorkspaceEdit();
            edit.replace(editor.document.uri, new vscode.Range(0, 0, 0, 5), "HELLO");
            return vscode.workspace.applyEdit(edit);
        }),
    );

    // Вставляет "X" в начало каждого из переданных файлов (массив fsPath).
    context.subscriptions.push(
        vscode.commands.registerCommand("test.applyToFiles", function (paths) {
            const edit = new vscode.WorkspaceEdit();
            for (const p of paths) {
                edit.insert(vscode.Uri.file(p), new vscode.Position(0, 0), "X");
            }
            return vscode.workspace.applyEdit(edit);
        }),
    );

    // Текстовая правка + файловая операция: не поддержано — ждём честный false.
    context.subscriptions.push(
        vscode.commands.registerCommand("test.applyWithFileOp", function () {
            const editor = vscode.window.activeTextEditor;
            if (editor == null) return null;
            const edit = new vscode.WorkspaceEdit();
            edit.replace(editor.document.uri, new vscode.Range(0, 0, 0, 1), "Y");
            edit.renameFile(editor.document.uri, vscode.Uri.file("/tmp/renamed.txt"));
            return vscode.workspace.applyEdit(edit);
        }),
    );
};
