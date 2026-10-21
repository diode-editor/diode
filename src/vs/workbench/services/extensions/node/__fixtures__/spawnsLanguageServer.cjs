"use strict";

/**
 * Fixture for extensionHost.orphans.test.ts. Mimics an extension with a language
 * server: `activate` starts a long-lived GRANDCHILD process (as redhat.java
 * starts jdtls) and returns its pid via the `test.orphans.serverPid` command.
 *
 * The extension deliberately does NOT close the grandchild in `deactivate`: that is how
 * an extension behaves when it crashed or had no time to say goodbye. A signal to the direct
 * subprocess does not reach such a grandchild, so a group signal
 * (`process.kill(-pid)`) must take it down, otherwise it stays an orphan and keeps
 * writing into the extension's directories.
 */
const cp = require("node:child_process");

/** The grandchild just lives: holds a timer and does nothing. */
const SERVER_SOURCE = "setInterval(function () {}, 1000);";

exports.activate = function activate(context) {
    const vscode = require("vscode");
    const server = cp.spawn(process.execPath, ["-e", SERVER_SOURCE], { stdio: "ignore" });
    context.subscriptions.push(
        vscode.commands.registerCommand("test.orphans.serverPid", function () {
            return server.pid;
        }),
    );
};
