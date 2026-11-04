"use strict";

/**
 * Three decoration types over every visible editor, redrawn on each document change:
 * - `trailing` — Trailing Spaces' call: a translucent CSS background plus a border the terminal can't draw;
 * - `merge` — vscode.merge-conflict's call: a whole-line ThemeColor background on the line `mine`;
 * - `themed` — light/dark branches with different backgrounds and a text color, on the word `themed`.
 * `text-decorations.toggle` clears the sets and disposes the types; run again, it brings them back.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    let types;

    function createTypes() {
        return {
            trailing: vscode.window.createTextEditorDecorationType({
                borderRadius: "3px",
                borderWidth: "1px",
                borderStyle: "solid",
                backgroundColor: "rgba(255,0,0,0.3)",
                borderColor: "rgba(255,100,100,0.15)",
            }),
            merge: vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                backgroundColor: new vscode.ThemeColor("merge.currentContentBackground"),
            }),
            themed: vscode.window.createTextEditorDecorationType({
                color: "#ff00ff",
                light: { backgroundColor: "#ffd700" },
                dark: { backgroundColor: "#003366" },
            }),
        };
    }

    function rangesOf(document, re) {
        const ranges = [];
        for (let line = 0; line < document.lineCount; line++) {
            const text = document.lineAt(line).text;
            re.lastIndex = 0;
            let match;
            while ((match = re.exec(text)) !== null) {
                ranges.push(new vscode.Range(line, match.index, line, match.index + match[0].length));
                if (!re.global) break;
            }
        }
        return ranges;
    }

    function paint(editor) {
        if (types === undefined) return;
        const document = editor.document;
        editor.setDecorations(types.trailing, rangesOf(document, /[ \t]+$/));
        editor.setDecorations(types.merge, rangesOf(document, /^mine$/));
        editor.setDecorations(types.themed, rangesOf(document, /\bthemed\b/g));
    }

    function paintAll() {
        for (const editor of vscode.window.visibleTextEditors) paint(editor);
    }

    types = createTypes();
    paintAll();
    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(paintAll),
        vscode.workspace.onDidChangeTextDocument(paintAll),
        vscode.commands.registerCommand("text-decorations.toggle", () => {
            if (types === undefined) {
                types = createTypes();
                paintAll();
                return;
            }
            for (const editor of vscode.window.visibleTextEditors) editor.setDecorations(types.trailing, []);
            for (const type of Object.values(types)) type.dispose();
            types = undefined;
        }),
    );
};

exports.deactivate = function deactivate() {};
