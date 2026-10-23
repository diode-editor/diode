"use strict";

/**
 * `lazy.js` is required on the first command, not at activation: a live extension host that loaded
 * version A keeps resolving modules against A's directory until a reload, and the command shows
 * whether that directory survived an update made by another process.
 */

const path = require("path");

exports.activate = function activate(context) {
    const vscode = require("vscode");

    const channel = vscode.window.createOutputChannel("Version Probe");
    context.subscriptions.push(channel);
    channel.appendLine("activated from " + path.basename(__dirname));

    context.subscriptions.push(
        vscode.commands.registerCommand("acme.probe.version", function () {
            try {
                const lazy = require("./lazy.js");
                channel.appendLine("lazy version " + lazy.version + " from " + lazy.dir);
            } catch (err) {
                channel.appendLine("lazy failed: " + (err && err.code ? err.code : String(err)));
            }
        }),
    );
};

exports.deactivate = function deactivate() {};
