"use strict";

/**
 * Фикстура стока диагностик: команда `test.diag.publish` публикует одну
 * диагностику в ресурс через createDiagnosticCollection (сквозной путь до
 * diagnosticsSink хоста), `test.diag.clear` — чистит коллекцию.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const collection = vscode.languages.createDiagnosticCollection("fixture");
    context.subscriptions.push(
        vscode.commands.registerCommand("test.diag.publish", function (uriStr, message) {
            const diag = new vscode.Diagnostic(
                new vscode.Range(0, 1, 0, 5),
                message,
                vscode.DiagnosticSeverity.Warning,
            );
            diag.source = "fixture";
            collection.set(vscode.Uri.parse(uriStr), [diag]);
            return "published";
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("test.diag.clear", function () {
            collection.clear();
            return "cleared";
        }),
    );
};
