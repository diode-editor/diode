"use strict";

/**
 * Fixture for `workspace.openTextDocument({ content, language })`, exactly what
 * `Go: Locate Configured Go Tools` in the stock golang.go does: a report in an
 * untitled document, then `window.showTextDocument(doc)`.
 *
 * `test.untitled.open {content?, language?, show?}` opens the document (and
 * shows it when `show` is set) and returns what the extension sees: the document,
 * whether it was in `workspace.textDocuments` and `onDidOpenTextDocument` by the time
 * the promise resolved, and the editor after showing.
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
