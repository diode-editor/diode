"use strict";

/**
 * Code actions fixture (#196): a provider with kind metadata returns
 * - organize imports with a ready WorkspaceEdit (sorts import lines);
 * - fix all with a LAZY edit that arrives only from resolveCodeAction
 *   (the codeAction/resolve path of real LSP servers);
 * - a quickfix action with a command instead of edits (the command path).
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
                    // No edits on purpose: resolveCodeAction fills them in.

                    const viaCommand = new vscode.CodeAction("Append marker", vscode.CodeActionKind.QuickFix);
                    viaCommand.command = {
                        title: "append",
                        command: "test.appendMarker",
                        arguments: ["!fixed"],
                    };

                    return [organize, fixAll, viaCommand];
                },
                resolveCodeAction(action) {
                    // Resolve only the lazy fix all: the command action
                    // must go through apply without edits (like command-only actions from servers).
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
