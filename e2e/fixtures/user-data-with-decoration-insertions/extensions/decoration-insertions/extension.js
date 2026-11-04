"use strict";

/**
 * Two decoration types over every visible editor, set when an editor becomes visible and NOT on document
 * changes — between two sets the cells must follow the text by themselves:
 * - `swatch` — the type Tailwind CSS IntelliSense 0.16 creates (a blank `before` box with a theme-branch border),
 *   set on each `bg-red-500` with the color in `renderOptions`, fractional channels included, as the
 *   Tailwind language server sends it;
 * - `blame` — a GitLens/Error Lens-like `after` text in its own color and italic, on each line `let …`; the
 *   line `let b` overrides the text and the color per range.
 * `decoration-insertions.toggle` clears the sets and disposes the types; run again, it brings them back.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    let types;

    function createTypes() {
        return {
            swatch: vscode.window.createTextEditorDecorationType({
                before: {
                    width: "0.8em",
                    height: "0.8em",
                    contentText: " ",
                    border: "0.1em solid",
                    margin: "0.1em 0.2em 0",
                },
                dark: { before: { borderColor: "#eeeeee" } },
                light: { before: { borderColor: "#000000" } },
            }),
            blame: vscode.window.createTextEditorDecorationType({
                after: { contentText: "  You, 2 days ago", color: "#8a8a8a", fontStyle: "italic" },
                light: { after: { color: "#6a6a6a" } },
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
            }
        }
        return ranges;
    }

    function paint(editor) {
        if (types === undefined) return;
        const document = editor.document;
        editor.setDecorations(
            types.swatch,
            rangesOf(document, /\bbg-red-500\b/g).map((range) => ({
                range,
                renderOptions: { before: { backgroundColor: "rgba(239.00000000000003, 68, 68, 1)" } },
            })),
        );
        editor.setDecorations(
            types.blame,
            rangesOf(document, /^let \w+.*$/g).map((range) =>
                document.lineAt(range.start.line).text.startsWith("let b")
                    ? { range, renderOptions: { after: { contentText: "  Error: b is unused", color: "#f14c4c" } } }
                    : { range },
            ),
        );
    }

    function paintAll() {
        for (const editor of vscode.window.visibleTextEditors) paint(editor);
    }

    types = createTypes();
    paintAll();
    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(paintAll),
        vscode.commands.registerCommand("decoration-insertions.toggle", () => {
            if (types === undefined) {
                types = createTypes();
                paintAll();
                return;
            }
            for (const editor of vscode.window.visibleTextEditors) editor.setDecorations(types.swatch, []);
            for (const type of Object.values(types)) type.dispose();
            types = undefined;
        }),
    );
};

exports.deactivate = function deactivate() {};
