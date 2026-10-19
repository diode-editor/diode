"use strict";

/**
 * Фикстура стока диагностик: команда `test.diag.publish` публикует одну
 * диагностику в ресурс через createDiagnosticCollection (сквозной путь до
 * diagnosticsSink хоста), `test.diag.clear` — чистит коллекцию.
 * Обратный путь: `test.diag.get` — `languages.getDiagnostics` (с ресурсом или
 * без) в сериализуемом виде, `test.diag.changes` — ресурсы всех событий
 * `onDidChangeDiagnostics` с активации.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const collection = vscode.languages.createDiagnosticCollection("fixture");
    const changes = [];
    context.subscriptions.push(
        vscode.languages.onDidChangeDiagnostics(function (e) {
            changes.push(
                e.uris.map(function (uri) {
                    return uri.toString();
                }),
            );
        }),
    );
    function plain(diag) {
        return {
            message: diag.message,
            severity: diag.severity,
            source: diag.source,
            code: diag.code,
            range: [diag.range.start.line, diag.range.start.character, diag.range.end.line, diag.range.end.character],
        };
    }
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
    context.subscriptions.push(
        vscode.commands.registerCommand("test.diag.get", function (uriStr) {
            if (uriStr) return vscode.languages.getDiagnostics(vscode.Uri.parse(uriStr)).map(plain);
            return vscode.languages.getDiagnostics().map(function (entry) {
                return [entry[0].toString(), entry[1].map(plain)];
            });
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("test.diag.changes", function () {
            return changes;
        }),
    );
};
