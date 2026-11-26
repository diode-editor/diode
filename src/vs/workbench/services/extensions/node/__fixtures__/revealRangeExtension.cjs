"use strict";

/**
 * Fixture for extensionHost.revealRange.test.ts. Editors are addressed by view column; a closed one is
 * kept to call on it afterwards, as an extension holding a stale `TextEditor` does.
 */
const vscode = require("vscode");

let held;

function editorIn(viewColumn) {
    const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.viewColumn === viewColumn);
    if (editor === undefined) throw new Error(`no editor in column ${viewColumn}`);
    return editor;
}

exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand("test.reveal.range", (viewColumn, line, typeName, endLine = line) => {
            const type = typeName === undefined ? undefined : vscode.TextEditorRevealType[typeName];
            editorIn(viewColumn).revealRange(new vscode.Range(line, 0, endLine, 0), type);
        }),
        vscode.commands.registerCommand("test.reveal.enum", () => {
            return { ...vscode.TextEditorRevealType };
        }),
        vscode.commands.registerCommand("test.reveal.indent", (viewColumn) => {
            const { tabSize, insertSpaces } = editorIn(viewColumn).options;
            return { tabSize, insertSpaces };
        }),
        vscode.commands.registerCommand("test.reveal.hold", (viewColumn) => {
            held = editorIn(viewColumn);
        }),
        vscode.commands.registerCommand("test.reveal.onHeld", () => {
            held.revealRange(new vscode.Range(100, 0, 100, 0));
            return "no throw";
        }),
    );
};
