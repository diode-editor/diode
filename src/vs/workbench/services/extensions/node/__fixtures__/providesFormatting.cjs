"use strict";

/**
 * Фикстура провайдеров форматирования (#196): документный провайдер схлопывает
 * повторные пробелы во всём документе одним full-range TextEdit'ом (так ведут
 * себя настоящие LSP-форматтеры), range-провайдер — только внутри диапазона.
 * Команда test.invokeFormatDocument повторяет путь maptz.regionfolder:
 * executeCommand("editor.action.formatDocument") из субпроцесса.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    function collapseSpaces(text) {
        return text.replace(/ {2,}/g, " ");
    }

    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider("plaintext", {
            provideDocumentFormattingEdits(document) {
                const text = document.getText();
                const formatted = collapseSpaces(text);
                if (formatted === text) return [];
                const lastLine = document.lineCount - 1;
                const fullRange = new vscode.Range(0, 0, lastLine, document.lineAt(lastLine).text.length);
                return [vscode.TextEdit.replace(fullRange, formatted)];
            },
        }),
    );

    context.subscriptions.push(
        vscode.languages.registerDocumentRangeFormattingEditProvider("plaintext", {
            provideDocumentRangeFormattingEdits(document, range) {
                const segment = document.getText(range);
                const formatted = collapseSpaces(segment);
                if (formatted === segment) return [];
                return [vscode.TextEdit.replace(range, formatted)];
            },
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("test.invokeFormatDocument", function () {
            return vscode.commands.executeCommand("editor.action.formatDocument");
        }),
    );
};
