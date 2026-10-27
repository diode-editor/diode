"use strict";

/**
 * Fixture for extensionHost.cursorStyle.test.ts, set like vscodevim does it: read `options`, change
 * `cursorStyle`, assign the object back. Editors are addressed by view column.
 */
const vscode = require("vscode");

function editorIn(viewColumn) {
    const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.viewColumn === viewColumn);
    if (editor === undefined) throw new Error(`no editor in column ${viewColumn}`);
    return editor;
}

exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand("test.cursor.set", (viewColumn, style) => {
            const editor = editorIn(viewColumn);
            const options = editor.options;
            options.cursorStyle = style;
            editor.options = options;
            // Read right after the assignment, before any round trip to the host.
            return editor.options.cursorStyle;
        }),
        vscode.commands.registerCommand("test.cursor.get", (viewColumn) => {
            return editorIn(viewColumn).options.cursorStyle;
        }),
        vscode.commands.registerCommand("test.cursor.enum", () => {
            return { ...vscode.TextEditorCursorStyle };
        }),
    );
};
