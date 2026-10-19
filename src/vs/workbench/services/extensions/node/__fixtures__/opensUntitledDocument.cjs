"use strict";

/**
 * Фикстура `workspace.openTextDocument({ content, language })` — ровно то, что
 * делает `Go: Locate Configured Go Tools` у стокового golang.go: отчёт в
 * безымянный документ, затем `window.showTextDocument(doc)`.
 *
 * `test.untitled.open {content?, language?, show?}` — открывает документ (и
 * показывает при `show`), отдаёт, что видит расширение: сам документ, был ли
 * он в `workspace.textDocuments` и `onDidOpenTextDocument` к моменту резолва,
 * и редактор после показа.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const openedUris = [];
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(function (doc) {
            openedUris.push(doc.uri.toString());
        }),
    );

    function describe(doc) {
        return {
            uri: doc.uri.toString(),
            scheme: doc.uri.scheme,
            isUntitled: doc.isUntitled,
            isDirty: doc.isDirty,
            languageId: doc.languageId,
            text: doc.getText(),
        };
    }

    context.subscriptions.push(
        vscode.commands.registerCommand("test.untitled.open", async function (options) {
            const args = options || {};
            const openOptions = {};
            if (args.content !== undefined) openOptions.content = args.content;
            if (args.language !== undefined) openOptions.language = args.language;
            const doc = await vscode.workspace.openTextDocument(openOptions);
            const result = {
                document: describe(doc),
                inTextDocuments: vscode.workspace.textDocuments.indexOf(doc) >= 0,
                firedOnDidOpen: openedUris.indexOf(doc.uri.toString()) >= 0,
            };
            if (args.show === true) {
                const editor = await vscode.window.showTextDocument(doc);
                result.editor = {
                    sameDocument: editor.document === doc,
                    isActive: vscode.window.activeTextEditor === editor,
                    viewColumn: editor.viewColumn,
                };
            }
            return result;
        }),
    );
};
