"use strict";

/**
 * Fixture for the built-in API command `vscode.open`, with calls as in golang.go
 * (`Go: Toggle Test File`): `test.open.file {path, viewColumn?}` calls
 * `executeCommand("vscode.open", Uri.file(path), viewColumn)` and returns
 * `{ ok: true, result }` or `{ ok: false, message }` if the promise rejects;
 * `test.open.raw {arg}` does the same with a raw first argument (invalid input).
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
