"use strict";

/**
 * Formatting provider fixture (#196): the document provider collapses
 * repeated spaces across the whole document with one full-range TextEdit (the way
 * real LSP formatters behave), the range provider only inside the range.
 * The test.invokeFormatDocument command follows the maptz.regionfolder path:
 * executeCommand("editor.action.formatDocument") from the subprocess.
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
