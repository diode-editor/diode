"use strict";

/**
 * will-save fixture: delegates the transformation to a built-in core command via
 * a nested executeCommand inside waitUntil (as the stock editorconfig delegates
 * editor.action.trimTrailingWhitespace to the active document). Checks that
 * a nested RPC works while a will-save is pending, and that the command itself mutates
 * the buffer (the participant returns no TextEdit[] of its own).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.workspace.onWillSaveTextDocument(function (event) {
            event.waitUntil(vscode.commands.executeCommand("editor.action.trimTrailingWhitespace"));
        }),
    );
};
