"use strict";

/**
 * Fixture for extensionHost.editorOptions.edges.test.ts: records `window.onDidChangeTextEditorOptions` by view column
 * (with the getter's value at event time) and assigns `options` to the editor of a column.
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
            events.push({
                viewColumn: e.textEditor.viewColumn,
                options: { ...e.options },
                getter: { ...e.textEditor.options },
            });
        }),
        vscode.commands.registerCommand("test.optionsEdges.take", () => events.splice(0)),
        vscode.commands.registerCommand("test.optionsEdges.setMany", (viewColumn, list) => {
            const editor = editorIn(viewColumn);
            for (const options of list) editor.options = options;
        }),
        vscode.commands.registerCommand("test.optionsEdges.setAndGet", (viewColumn, options) => {
            const editor = editorIn(viewColumn);
            editor.options = options;
            return { ...editor.options };
        }),
        vscode.commands.registerCommand("test.optionsEdges.get", (viewColumn) => ({ ...editorIn(viewColumn).options })),
        vscode.commands.registerCommand("test.optionsEdges.activeGet", () => {
            const editor = vscode.window.activeTextEditor;
            return editor === undefined ? null : { ...editor.options };
        }),
    );
};
