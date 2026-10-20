"use strict";

/**
 * Демо-расширение панели действий группы (`contributes.menus["editor/title"]`)
 * в форме вклада стокового Claude Code: кнопки accept/reject предложенного
 * диффа (`$(check)`/`$(discard)`) видны, пока стоит setContext-ключ
 * `editorTitleDemo.viewingProposedDiff`; пункт с SVG-иконкой — под
 * `config.editorTitleDemo.useTerminal`. Что нажали — пункт статус-бара `title:`.
 *
 * Используется e2e-сценарием editorTitle и ручной проверкой:
 *   diode --user-data-dir=<каталог с этой фикстурой> <какой-нибудь файл>
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const result = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    result.text = "title:-";
    result.show();
    context.subscriptions.push(result);

    const viewing = (on) => vscode.commands.executeCommand("setContext", "editorTitleDemo.viewingProposedDiff", on);
    context.subscriptions.push(
        vscode.commands.registerCommand("editorTitleDemo.propose", () => {
            result.text = "title:proposed";
            return viewing(true);
        }),
        vscode.commands.registerCommand("editorTitleDemo.accept", () => {
            result.text = "title:accepted";
            return viewing(false);
        }),
        vscode.commands.registerCommand("editorTitleDemo.reject", () => {
            result.text = "title:rejected";
            return viewing(false);
        }),
        vscode.commands.registerCommand("editorTitleDemo.open", () => {
            result.text = "title:open";
        }),
    );
};

exports.deactivate = function deactivate() {};
