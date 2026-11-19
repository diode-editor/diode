"use strict";

/**
 * Status bar, one item per view column: `C<column> <tabSize>/<insertSpaces>/<cursorStyle> #<events>`, e.g.
 * `C1 2/true/2 #1`. The values come from the last `window.onDidChangeTextEditorOptions` of that column (the getter
 * before the first one), the count from the event. A command assigns `options = { tabSize: 8 }` to the editor in
 * column 1, whichever editor is active.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const items = new Map();
    const counts = new Map();

    function itemFor(column) {
        let item = items.get(column);
        if (item === undefined) {
            item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 300 - column);
            item.name = "Editor Options " + column;
            context.subscriptions.push(item);
            items.set(column, item);
        }
        return item;
    }

    function format(options) {
        return options.tabSize + "/" + options.insertSpaces + "/" + options.cursorStyle;
    }

    function show(column, options) {
        const item = itemFor(column);
        item.text = "C" + column + " " + format(options) + " #" + (counts.get(column) ?? 0);
        item.show();
    }

    function render() {
        for (const editor of vscode.window.visibleTextEditors) show(editor.viewColumn ?? 0, editor.options);
    }

    render();
    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(render),
        vscode.window.onDidChangeTextEditorOptions(function (event) {
            const column = event.textEditor.viewColumn ?? 0;
            counts.set(column, (counts.get(column) ?? 0) + 1);
            // The getter already holds the event's value.
            if (format(event.textEditor.options) !== format(event.options)) {
                itemFor(column).text = "C" + column + " MISMATCH";
                return;
            }
            show(column, event.options);
        }),
        vscode.commands.registerCommand("editorOptionsDemo.tabSize8InColumn1", function () {
            const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.viewColumn === 1);
            if (editor !== undefined) editor.options = { tabSize: 8 };
        }),
    );
};
