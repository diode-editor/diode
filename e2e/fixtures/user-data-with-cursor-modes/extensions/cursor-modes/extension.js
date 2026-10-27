"use strict";

/**
 * Sets the cursor the way vscodevim does: read the active editor's `options`, change `cursorStyle`,
 * assign the object back. Normal mode is a block, insert mode a bar; other editors keep their own.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    function setStyle(style) {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) return;
        const options = editor.options;
        options.cursorStyle = style;
        editor.options = options;
    }

    context.subscriptions.push(
        vscode.commands.registerCommand("cursorModes.normal", function () {
            setStyle(vscode.TextEditorCursorStyle.Block);
        }),
        vscode.commands.registerCommand("cursorModes.insert", function () {
            setStyle(vscode.TextEditorCursorStyle.Line);
        }),
    );
};
