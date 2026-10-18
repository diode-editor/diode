"use strict";

/**
 * Фикстура встроенной API-команды `vscode.open` — вызовы как у golang.go
 * (`Go: Toggle Test File`): `test.open.file {path, viewColumn?}` зовёт
 * `executeCommand("vscode.open", Uri.file(path), viewColumn)` и отдаёт
 * `{ ok: true, result }` либо `{ ok: false, message }` при отказе промиса;
 * `test.open.raw {arg}` — то же с сырым первым аргументом (невалидный ввод).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    function settle(promise) {
        return promise.then(
            function (result) {
                return { ok: true, result: result === undefined ? "undefined" : result };
            },
            function (error) {
                return { ok: false, message: String(error && error.message) };
            },
        );
    }

    context.subscriptions.push(
        vscode.commands.registerCommand("test.open.file", function (args) {
            return settle(vscode.commands.executeCommand("vscode.open", vscode.Uri.file(args.path), args.viewColumn));
        }),
        vscode.commands.registerCommand("test.open.raw", function (args) {
            return settle(vscode.commands.executeCommand("vscode.open", args.arg));
        }),
    );
};
