"use strict";

/**
 * `withProgress` in a view: the view's header spins while the task runs, and only spins — the message,
 * the percent and Cancel are not shown there, as upstream. The status bar says when the task resolved.
 */
const vscode = require("vscode");

const HOLD_MS = 4000;

function runIn(location, focusCommand, done) {
    return async function () {
        await vscode.commands.executeCommand(focusCommand);
        const result = await vscode.window.withProgress(
            { location: location, title: "Indexing", cancellable: true },
            function (progress) {
                progress.report({ message: "half way", increment: 50 });
                return new Promise(function (resolve) {
                    setTimeout(function () {
                        resolve(done);
                    }, HOLD_MS);
                });
            },
        );
        vscode.window.setStatusBarMessage(result, 10000);
    };
}

exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "progressProbe.inView",
            runIn({ viewId: "progressProbe.items" }, "progressProbe.items.focus", "Probe: indexed in view"),
        ),
        vscode.commands.registerCommand(
            "progressProbe.inScm",
            runIn(vscode.ProgressLocation.SourceControl, "workbench.view.scm", "Probe: indexed in SCM"),
        ),
    );
};

exports.deactivate = function deactivate() {};
