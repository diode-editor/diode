"use strict";

/**
 * Decoration types over every visible editor, each on the lines that start with its name:
 * - `bar` — GitLens's change bar: a `data:` URI SVG with one tall `<rect>`;
 * - `dot` — Error Lens's icon: an SVG file with a gray backdrop circle under a green one, by a path string;
 * - `png` — a PNG file: no color of its own;
 * - `broken` — a file that does not exist;
 * - `ruler` — todo-tree's highlight: a CSS `overviewRulerColor` and no icon.
 * A dormant debugger with `contributes.breakpoints` for plain text lets F9 put a breakpoint on a line.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const rect =
        "<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><rect fill='#00bcf2' x='13' y='0' width='3' height='18'/></svg>";
    const types = {
        bar: vscode.window.createTextEditorDecorationType({
            gutterIconPath: vscode.Uri.parse("data:image/svg+xml," + encodeURIComponent(rect)),
            gutterIconSize: "contain",
        }),
        dot: vscode.window.createTextEditorDecorationType({
            gutterIconPath: context.asAbsolutePath("icons/dot.svg"),
        }),
        png: vscode.window.createTextEditorDecorationType({
            gutterIconPath: vscode.Uri.file(context.asAbsolutePath("icons/icon.png")),
        }),
        broken: vscode.window.createTextEditorDecorationType({
            gutterIconPath: context.asAbsolutePath("icons/missing.svg"),
        }),
        ruler: vscode.window.createTextEditorDecorationType({
            overviewRulerColor: "#ff0000",
            overviewRulerLane: vscode.OverviewRulerLane.Right,
        }),
    };
    for (const type of Object.values(types)) context.subscriptions.push(type);

    function paint(editor) {
        const document = editor.document;
        for (const [name, type] of Object.entries(types)) {
            const ranges = [];
            for (let line = 0; line < document.lineCount; line++) {
                if (document.lineAt(line).text.startsWith(name)) ranges.push(new vscode.Range(line, 0, line, 0));
            }
            editor.setDecorations(type, ranges);
        }
    }

    function paintAll() {
        for (const editor of vscode.window.visibleTextEditors) paint(editor);
    }

    paintAll();
    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(paintAll),
        vscode.workspace.onDidChangeTextDocument(paintAll),
    );
};

exports.deactivate = function deactivate() {};
