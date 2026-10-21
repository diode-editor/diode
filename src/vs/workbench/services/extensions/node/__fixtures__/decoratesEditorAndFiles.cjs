"use strict";

/**
 * Fixture for ExtensionHost.Decorations.test.ts (Chunk 4, host-bridge).
 *
 * In activate():
 *  - creates a gutter change-bar type (`overviewRulerColor` = ThemeColor) and
 *    a "plain" type without overviewRulerColor (the host ignores it: not gutter);
 *  - applies both to the active editor (the gutter type has two ranges);
 *  - registers a FileDecorationProvider (color + badge for `notes.md`, otherwise cleared).
 *
 * Commands `test.fireFileDecoration(fsPath)` / `test.disposeGutterType()` let
 * the test move the state after activate.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const gutterType = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        overviewRulerLane: vscode.OverviewRulerLane.Left,
        overviewRulerColor: new vscode.ThemeColor("editorGutter.modifiedBackground"),
    });
    context.subscriptions.push(gutterType);

    // A type without overviewRulerColor is not gutter; the host does not project its decorations.
    const plainType = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor("editor.background"),
    });
    context.subscriptions.push(plainType);

    const editor = vscode.window.activeTextEditor;
    if (editor != null) {
        editor.setDecorations(gutterType, [new vscode.Range(1, 0, 1, 0), new vscode.Range(3, 0, 3, 0)]);
        editor.setDecorations(plainType, [new vscode.Range(0, 0, 0, 5)]);
    }

    let cleared = false;
    const emitter = new vscode.EventEmitter();
    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider({
            onDidChangeFileDecorations: emitter.event,
            provideFileDecoration: function (uri) {
                if (!cleared && uri.fsPath.endsWith("notes.md")) {
                    return new vscode.FileDecoration(
                        "M",
                        "Modified",
                        new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
                    );
                }
                return undefined;
            },
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("test.fireFileDecoration", function (fsPath) {
            emitter.fire(vscode.Uri.file(fsPath));
        }),
    );
    // Switches the provider to "cleared" mode: the next provideFileDecoration returns undefined.
    context.subscriptions.push(
        vscode.commands.registerCommand("test.setCleared", function () {
            cleared = true;
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("test.disposeGutterType", function () {
            gutterType.dispose();
        }),
    );
};
