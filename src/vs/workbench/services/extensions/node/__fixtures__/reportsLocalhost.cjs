"use strict";

/**
 * Fixture for extensionHost.localhost.test.ts: the extension starts a TCP server
 * on `localhost` (as bazel-java does for its language server log) and
 * reports which address it bound to and the DNS resolution order in the subprocess.
 */
const dns = require("node:dns");
const net = require("node:net");

exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.commands.registerCommand("test.localhost.resultOrder", () => dns.getDefaultResultOrder()),
        vscode.commands.registerCommand(
            "test.localhost.listen",
            () =>
                new Promise((resolve, reject) => {
                    const server = net.createServer();
                    server.on("error", reject);
                    server.listen(0, "localhost", () => {
                        const address = server.address();
                        server.close(() => resolve(address.address));
                    });
                }),
        ),
    );
};
exports.deactivate = function deactivate() {};
