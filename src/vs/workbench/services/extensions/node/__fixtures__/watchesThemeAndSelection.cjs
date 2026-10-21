"use strict";

/**
 * Fixture for extensionHost.themeAndSelection.test.ts. Reads
 * `window.activeColorTheme` at activation, collects
 * `onDidChangeActiveColorTheme` and `onDidChangeTextEditorSelection` events and returns it all
 * via the `test.themeSelection.report` command.
 *
 * Comparisons are made HERE, through the runtime enums `vscode.ColorThemeKind` /
 * `vscode.TextEditorSelectionChangeKind`: this way the test also checks that
 * the enums reach the extension as real values, not just types.
 */

exports.activate = function activate(context) {
    const vscode = require("vscode");

    const themeAtActivate = vscode.window.activeColorTheme.kind;
    const isDarkAtActivate = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
    const themeEvents = [];
    const selectionEvents = [];

    context.subscriptions.push(
        vscode.window.onDidChangeActiveColorTheme(function (theme) {
            themeEvents.push({
                kind: theme.kind,
                isLight: theme.kind === vscode.ColorThemeKind.Light,
                // The namespace property must be updated BEFORE dispatch.
                matchesNamespace: theme.kind === vscode.window.activeColorTheme.kind,
            });
        }),
        vscode.window.onDidChangeTextEditorSelection(function (event) {
            selectionEvents.push({
                fileName: event.textEditor.document.fileName,
                kind: event.kind === undefined ? null : event.kind,
                isMouse: event.kind === vscode.TextEditorSelectionChangeKind.Mouse,
                selections: event.selections.map(function (s) {
                    return [s.anchor.line, s.anchor.character, s.active.line, s.active.character];
                }),
                // The event must carry the same editor object as the namespace,
                // with the selection already updated.
                isActiveEditor: event.textEditor === vscode.window.activeTextEditor,
                editorSelection: [event.textEditor.selection.active.line, event.textEditor.selection.active.character],
            });
        }),
        vscode.commands.registerCommand("test.themeSelection.report", function () {
            return {
                themeAtActivate: themeAtActivate,
                isDarkAtActivate: isDarkAtActivate,
                themeNow: vscode.window.activeColorTheme.kind,
                themeEvents: themeEvents,
                selectionEvents: selectionEvents,
            };
        }),
    );
};
