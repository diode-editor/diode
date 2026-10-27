"use strict";

/**
 * Fixture for extensionHost.cursorStyle.edges.test.ts: shapes the active editor the way vscodevim does
 * (read `options`, change `cursorStyle`, assign the object back), one or several styles in a row.
 */
const vscode = require("vscode");

function active() {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) throw new Error("no active editor");
    return editor;
}

exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand("test.cursorActive.set", (...styles) => {
            const editor = active();
            for (const style of styles) {
                const options = editor.options;
                options.cursorStyle = style;
                editor.options = options;
            }
            return editor.options.cursorStyle;
        }),
        vscode.commands.registerCommand("test.cursorActive.setTabSize", (tabSize) => {
            const editor = active();
            editor.options = { tabSize };
            return editor.options.cursorStyle;
        }),
        vscode.commands.registerCommand("test.cursorActive.get", () => active().options.cursorStyle),
    );
};
