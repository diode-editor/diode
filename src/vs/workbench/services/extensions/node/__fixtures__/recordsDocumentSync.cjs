"use strict";

/**
 * Фикстура document sync: записывает снимок `workspace.textDocuments` на момент
 * активации (так стоковый vscode-languageclient читает документы на `start()`)
 * и события onDidOpen/onDidChange/onDidCloseTextDocument. Лог отдаётся командой
 * `test.docSync.dump` — host читает его через commandRegistry.execute.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const log = [];
    log.push({
        kind: "activate",
        docs: vscode.workspace.textDocuments.map(function (d) {
            return { uri: d.uri.toString(), languageId: d.languageId, version: d.version, text: d.getText() };
        }),
    });
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(function (doc) {
            log.push({ kind: "open", uri: doc.uri.toString(), version: doc.version, text: doc.getText() });
        }),
    );
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(function (e) {
            log.push({
                kind: "change",
                uri: e.document.uri.toString(),
                version: e.document.version,
                text: e.document.getText(),
                rangeLength: e.contentChanges[0].rangeLength,
                newText: e.contentChanges[0].text,
            });
        }),
    );
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(function (doc) {
            log.push({ kind: "close", uri: doc.uri.toString() });
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("test.docSync.dump", function () {
            return log;
        }),
    );
};
