"use strict";

/**
 * Fixture for extensionHost.editorOptions.test.ts: records `window.onDidChangeTextEditorOptions` by view column and
 * assigns `options` to the editor of a column. Editors are addressed by view column.
 */
const vscode = require("vscode");

const events = [];

function editorIn(viewColumn) {
    const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.viewColumn === viewColumn);
    if (editor === undefined) throw new Error(`no editor in column ${viewColumn}`);
    return editor;
}

exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorOptions((e) => {
            events.push({ viewColumn: e.textEditor.viewColumn, options: { ...e.options } });
        }),
        vscode.commands.registerCommand("test.options.take", () => events.splice(0)),
        vscode.commands.registerCommand("test.options.set", (viewColumn, options) => {
            editorIn(viewColumn).options = options;
        }),
        vscode.commands.registerCommand("test.options.get", (viewColumn) => ({ ...editorIn(viewColumn).options })),
    );
};
