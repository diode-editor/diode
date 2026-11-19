"use strict";

/**
 * Status bar: `OPEN <file> <first-last,...>` — `TextEditor.visibleRanges` exactly as read inside
 * `window.onDidChangeActiveTextEditor` (what Error Lens does), never updated by later events. Lines 1-based, inclusive.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 300);
    item.name = "Visible Ranges On Open";
    context.subscriptions.push(item);
    // Activated: nothing read yet.
    item.text = "OPEN -";
    item.show();

    function format(ranges) {
        return ranges.map((range) => range.start.line + 1 + "-" + (range.end.line + 1)).join(",");
    }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(function (editor) {
            if (editor === undefined) return;
            item.text = "OPEN " + editor.document.uri.path.split("/").pop() + " " + format(editor.visibleRanges);
            item.show();
        }),
    );
};
