"use strict";

/**
 * Демо-расширение двух окон API: активной темы и выделения.
 *
 *   - `window.activeColorTheme` + `onDidChangeActiveColorTheme` → пункт
 *     статус-бара `Theme: <вид>`; он верен уже в момент активации и меняется
 *     на смене темы (Ctrl+K Ctrl+T).
 *   - `window.onDidChangeTextEditorSelection` → пункт `Sel <строка>:<колонка>
 *     <вид жеста>`; вид берётся из `TextEditorSelectionChangeKind`, так что
 *     стрелка и клик мышью читаются по-разному.
 *
 * Используется e2e-сценарием themeSelectionApi и ручной проверкой:
 *   diode --user-data-dir=<каталог с этой фикстурой> <какой-нибудь файл>
 */

exports.activate = function activate(context) {
    const vscode = require("vscode");

    const THEME_NAMES = {
        [vscode.ColorThemeKind.Light]: "Light",
        [vscode.ColorThemeKind.Dark]: "Dark",
        [vscode.ColorThemeKind.HighContrast]: "HC",
        [vscode.ColorThemeKind.HighContrastLight]: "HCLight",
    };
    const KIND_NAMES = {
        [vscode.TextEditorSelectionChangeKind.Keyboard]: "Keyboard",
        [vscode.TextEditorSelectionChangeKind.Mouse]: "Mouse",
        [vscode.TextEditorSelectionChangeKind.Command]: "Command",
    };

    const themeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
    themeItem.name = "Demo Theme";
    const selectionItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 199);
    selectionItem.name = "Demo Selection";

    function renderTheme(theme) {
        themeItem.text = "Theme " + (THEME_NAMES[theme.kind] ?? "?" + theme.kind);
        themeItem.show();
    }

    // Тема верна уже здесь — хост присылает её ДО первой активации.
    renderTheme(vscode.window.activeColorTheme);

    selectionItem.text = "Sel —";
    selectionItem.show();

    context.subscriptions.push(
        themeItem,
        selectionItem,
        vscode.window.onDidChangeActiveColorTheme(renderTheme),
        vscode.window.onDidChangeTextEditorSelection(function (event) {
            const active = event.selections[0].active;
            const kind = event.kind === undefined ? "?" : (KIND_NAMES[event.kind] ?? "?");
            selectionItem.text = "Sel " + (active.line + 1) + ":" + (active.character + 1) + " " + kind;
        }),
    );
};
