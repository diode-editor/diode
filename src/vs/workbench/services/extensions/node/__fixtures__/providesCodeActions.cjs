"use strict";

/**
 * Фикстура code actions (#196): провайдер с метаданными видов отдаёт
 * - organize imports с готовым WorkspaceEdit (сортирует строки-импорты);
 * - fix all с ЛЕНИВЫМ edit'ом — приезжает только из resolveCodeAction
 *   (путь codeAction/resolve настоящих LSP-серверов);
 * - quickfix-действие с командой вместо правок (командный путь).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.commands.registerCommand("test.appendMarker", function (marker) {
            const editor = vscode.window.activeTextEditor;
            if (editor == null) return false;
            const last = editor.document.lineCount - 1;
            const end = editor.document.lineAt(last).text.length;
            return editor.edit(function (edit) {
                edit.insert(new vscode.Position(last, end), String(marker));
            });
        }),
    );

    function fullRange(document) {
        const last = document.lineCount - 1;
        return new vscode.Range(0, 0, last, document.lineAt(last).text.length);
    }

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            "plaintext",
            {
                provideCodeActions(document) {
                    const organize = new vscode.CodeAction(
                        "Sort lines",
                        vscode.CodeActionKind.SourceOrganizeImports,
                    );
                    const sorted = document.getText().split("\n").sort().join("\n");
                    organize.edit = new vscode.WorkspaceEdit();
                    organize.edit.replace(document.uri, fullRange(document), sorted);

                    const fixAll = new vscode.CodeAction("Lazy upper", vscode.CodeActionKind.SourceFixAll);
                    // Правок нет намеренно: их дорезолвит resolveCodeAction.

                    const viaCommand = new vscode.CodeAction("Append marker", vscode.CodeActionKind.QuickFix);
                    viaCommand.command = {
                        title: "append",
                        command: "test.appendMarker",
                        arguments: ["!fixed"],
                    };

                    return [organize, fixAll, viaCommand];
                },
                resolveCodeAction(action) {
                    // Дорезолвливаем только ленивый fix all: командное действие
                    // обязано пройти apply без правок (как command-only у серверов).
                    if (action.kind === undefined || !action.kind.contains(vscode.CodeActionKind.SourceFixAll)) {
                        return action;
                    }
                    const editor = vscode.window.activeTextEditor;
                    if (editor == null) return action;
                    const upper = editor.document.getText().toUpperCase();
                    action.edit = new vscode.WorkspaceEdit();
                    action.edit.replace(editor.document.uri, fullRange(editor.document), upper);
                    return action;
                },
            },
            {
                providedCodeActionKinds: [
                    vscode.CodeActionKind.SourceOrganizeImports,
                    vscode.CodeActionKind.SourceFixAll,
                    vscode.CodeActionKind.QuickFix,
                ],
            },
        ),
    );
};
