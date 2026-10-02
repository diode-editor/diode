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

    // Текстовая правка активного документа + переименование файла рядом:
    // смешанный edit, как у rename-рефакторинга.
    context.subscriptions.push(
        vscode.commands.registerCommand("test.applyRenameWithText", function (paths) {
            const editor = vscode.window.activeTextEditor;
            if (editor == null) return null;
            const edit = new vscode.WorkspaceEdit();
            edit.replace(editor.document.uri, new vscode.Range(0, 0, 0, 1), "Y");
            edit.renameFile(vscode.Uri.file(paths[0]), vscode.Uri.file(paths[1]));
            return vscode.workspace.applyEdit(edit);
        }),
    );

    // «Move to a new file»: создать файл с содержимым, дописать в него, убрать
    // исходный. Порядок операций значим.
    context.subscriptions.push(
        vscode.commands.registerCommand("test.applyMoveToNewFile", function (paths) {
            const created = vscode.Uri.file(paths[0]);
            const removed = vscode.Uri.file(paths[1]);
            const edit = new vscode.WorkspaceEdit();
            edit.createFile(created, { contents: new TextEncoder().encode("moved\n") });
            edit.insert(created, new vscode.Position(1, 0), "tail\n");
            edit.deleteFile(removed);
            return vscode.workspace.applyEdit(edit);
        }),
    );
};
