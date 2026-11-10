"use strict";

/**
 * Fixture for extensionHost.viewProgress.test.ts: `withProgress` in a view by id or in SourceControl,
 * held open until `finish`. `finish` resolves with what `withProgress` returned, so a task in an
 * unknown location is seen to run to the end.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const running = new Map();
    context.subscriptions.push(
        vscode.commands.registerCommand("test.viewProgress.start", function (key, where) {
            const location = where === "sourceControl" ? vscode.ProgressLocation.SourceControl : { viewId: where };
            let finish;
            const gate = new Promise(function (resolve) {
                finish = resolve;
            });
            const result = vscode.window.withProgress(
                { location: location, title: "Indexing", cancellable: true },
                function (progress) {
                    progress.report({ message: "half", increment: 50 });
                    return gate.then(function () {
                        return "done " + key;
                    });
                },
            );
            running.set(key, { finish: finish, result: result });
        }),
        vscode.commands.registerCommand("test.viewProgress.finish", function (key) {
            const entry = running.get(key);
            running.delete(key);
            entry.finish();
            return entry.result;
        }),
    );
};
