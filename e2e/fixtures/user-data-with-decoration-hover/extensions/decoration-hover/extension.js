"use strict";

/**
 * On every visible editor, on each line `const …`:
 * - `word` — a `hoverMessage` (a MarkdownString) on the name after `const`;
 * - `blame` — Git Blame's shape: an empty range at column `MAX_SAFE_INTEGER` with an `after` text and a
 *   MarkdownString `hoverMessage` of the commit;
 * - a diagnostic over the whole line, so the hover shows it above the decoration blocks.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const word = vscode.window.createTextEditorDecorationType({ color: "#4fc1ff" });
    const blame = vscode.window.createTextEditorDecorationType({});
    const diagnostics = vscode.languages.createDiagnosticCollection("decoration-hover");

    function paint(editor) {
        const document = editor.document;
        const words = [];
        const blames = [];
        const problems = [];
        for (let line = 0; line < document.lineCount; line++) {
            const text = document.lineAt(line).text;
            const match = /^const (\w+)/.exec(text);
            if (match === null) continue;
            const start = "const ".length;
            words.push({
                range: new vscode.Range(line, start, line, start + match[1].length),
                hoverMessage: new vscode.MarkdownString(`**${match[1]}** is a decorated name`),
            });
            const end = new vscode.Position(line, Number.MAX_SAFE_INTEGER);
            blames.push({
                range: new vscode.Range(end, end),
                hoverMessage: new vscode.MarkdownString(`__git blame__ feat: add ${match[1]}`),
                renderOptions: { after: { contentText: "Ann, 2 days ago", color: "#8a8a8a", margin: "0 0 0 2ch" } },
            });
            problems.push(
                new vscode.Diagnostic(
                    new vscode.Range(line, 0, line, text.length),
                    "Prefer let",
                    vscode.DiagnosticSeverity.Information,
                ),
            );
        }
        editor.setDecorations(word, words);
        editor.setDecorations(blame, blames);
        diagnostics.set(document.uri, problems);
    }

    function paintAll() {
        for (const editor of vscode.window.visibleTextEditors) paint(editor);
    }

    paintAll();
    context.subscriptions.push(word, blame, diagnostics, vscode.window.onDidChangeVisibleTextEditors(paintAll));
};

exports.deactivate = function deactivate() {};
