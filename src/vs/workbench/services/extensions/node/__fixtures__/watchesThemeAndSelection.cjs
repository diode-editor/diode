"use strict";

/**
 * Фикстура для extensionHost.themeAndSelection.test.ts. Читает
 * `window.activeColorTheme` в момент активации, копит события
 * `onDidChangeActiveColorTheme` и `onDidChangeTextEditorSelection` и отдаёт всё
 * командой `test.themeSelection.report`.
 *
 * Сравнения делаются ЗДЕСЬ, через runtime-enum'ы `vscode.ColorThemeKind` /
 * `vscode.TextEditorSelectionChangeKind`: так тест проверяет ещё и то, что
 * enum'ы отданы расширению настоящими значениями, а не типами.
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
                // Свойство namespace'а обязано быть обновлено ДО рассылки.
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
                // Событие обязано нести тот же объект редактора, что и namespace,
                // и уже обновлённое выделение.
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
