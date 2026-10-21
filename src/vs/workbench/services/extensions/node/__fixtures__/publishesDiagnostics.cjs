"use strict";

/**
 * Diagnostics sink fixture: the `test.diag.publish` command publishes one
 * diagnostic for a resource via createDiagnosticCollection (end to end up to
 * the host's diagnosticsSink), `test.diag.clear` clears the collection.
 * Reverse path: `test.diag.get` returns `languages.getDiagnostics` (with or without
 * a resource) in serializable form, `test.diag.changes` the resources of all
 * `onDidChangeDiagnostics` events since activation.
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
