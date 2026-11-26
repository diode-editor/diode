"use strict";

/**
 * Status bar, one item per view column: `C<column> <ranges> #<events>`, ranges 1-based and inclusive, e.g.
 * `C1 1-2,6-25 #3`. The ranges are read from `TextEditor.visibleRanges`, the count from
 * `window.onDidChangeTextEditorVisibleRanges`.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const items = new Map();
    const counts = new Map();

    function itemFor(column) {
        let item = items.get(column);
        if (item === undefined) {
            item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 300 - column);
            item.name = "Visible Ranges " + column;
            context.subscriptions.push(item);
            items.set(column, item);
        }
        return item;
    }

    function format(ranges) {
        return ranges.map((range) => range.start.line + 1 + "-" + (range.end.line + 1)).join(",");
    }

    function render() {
        for (const editor of vscode.window.visibleTextEditors) {
            const column = editor.viewColumn ?? 0;
            const item = itemFor(column);
            item.text = "C" + column + " " + format(editor.visibleRanges) + " #" + (counts.get(column) ?? 0);
            item.show();
        }
    }

    render();
    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(render),
        vscode.window.onDidChangeTextEditorVisibleRanges(function (event) {
            const column = event.textEditor.viewColumn ?? 0;
            counts.set(column, (counts.get(column) ?? 0) + 1);
            // The getter already holds the event's value.
            if (format(event.textEditor.visibleRanges) !== format(event.visibleRanges)) {
                itemFor(column).text = "C" + column + " MISMATCH";
                return;
            }
            render();
        }),
    );
};
