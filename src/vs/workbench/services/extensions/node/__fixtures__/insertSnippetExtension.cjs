"use strict";

/**
 * Fixture for extensionHost.insertSnippet.test.ts. `test.snippet.enter` is the shape of KevinRose.vsc-python-indent:
 * a text editor command that calls `insertSnippet` without awaiting it and reveals right after, leaving the edit
 * builder empty.
 */
const vscode = require("vscode");

let held;

function toLocation(location) {
    if (location === undefined) return undefined;
    return location.map(([line, character]) => new vscode.Position(line, character));
}

exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand("test.snippet.enter", (editor) => {
            const position = editor.selection.active;
            void editor.insertSnippet(new vscode.SnippetString("\n    $0\n"));
            editor.revealRange(new vscode.Range(position, new vscode.Position(position.line + 2, 0)));
        }),
        vscode.commands.registerCommand("test.snippet.insert", (template, location, options) =>
            vscode.window.activeTextEditor.insertSnippet(new vscode.SnippetString(template), toLocation(location), options),
        ),
        vscode.commands.registerCommand("test.snippet.hold", () => {
            held = vscode.window.activeTextEditor;
        }),
        vscode.commands.registerCommand("test.snippet.onHeld", async () => {
            try {
                return await held.insertSnippet(new vscode.SnippetString("x"));
            } catch (error) {
                return String(error.message);
            }
        }),
    );
};
