"use strict";

/**
 * Fixture for ExtensionHost.Decorations.test.ts (Chunk 4, host-bridge).
 *
 * In activate():
 *  - creates a scrollbar mark type (`overviewRulerColor` = ThemeColor), a "plain" type without
 *    overviewRulerColor (no marks) and a gutter icon type (`gutterIconPath`, GitLens's bar as a `data:` URI);
 *  - applies them to the active editor (the mark type has two ranges).
 *
 * Command `test.disposeGutterType()` lets the test move the state after activate.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const gutterType = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        overviewRulerLane: vscode.OverviewRulerLane.Left,
        overviewRulerColor: new vscode.ThemeColor("editorGutter.modifiedBackground"),
    });
    context.subscriptions.push(gutterType);

    // A type without overviewRulerColor marks nothing on the scrollbar.
    const plainType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor("editor.background"),
    });
    context.subscriptions.push(plainType);

    const bar =
        "<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18'><rect fill='#00bcf2' x='7' y='0' width='3' height='18'/></svg>";
    const iconType = vscode.window.createTextEditorDecorationType({
        gutterIconPath: vscode.Uri.parse("data:image/svg+xml," + encodeURIComponent(bar)),
        gutterIconSize: "contain",
    });
    context.subscriptions.push(iconType);

    const editor = vscode.window.activeTextEditor;
    if (editor != null) {
        editor.setDecorations(gutterType, [new vscode.Range(1, 0, 1, 0), new vscode.Range(3, 0, 3, 0)]);
        editor.setDecorations(plainType, [new vscode.Range(0, 0, 0, 5)]);
        editor.setDecorations(iconType, [new vscode.Range(2, 0, 2, 0)]);
    }

    context.subscriptions.push(
        vscode.commands.registerCommand("test.disposeGutterType", function () {
            gutterType.dispose();
        }),
    );
};
