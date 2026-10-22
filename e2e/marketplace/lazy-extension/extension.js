"use strict";

/**
 * The module is required only when the command runs: if its directory is gone (the version was replaced
 * under a running host), the require fails, as a lazily spawned language server would.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const channel = vscode.window.createOutputChannel("Lazy Version");
    context.subscriptions.push(
        vscode.commands.registerCommand("lazyVersion.show", () => {
            try {
                const { version } = require("./lazy/version.js");
                channel.appendLine(`lazy version ${version}`);
            } catch (err) {
                channel.appendLine(`lazy error ${err.code ?? err.message}`);
            }
            channel.show(true);
        }),
    );
};

exports.deactivate = function deactivate() {};
