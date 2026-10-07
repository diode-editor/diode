"use strict";

/**
 * Фикстура для extensionHost.localhost.test.ts: расширение поднимает TCP-сервер
 * на `localhost` — как bazel-java для лога своего языкового сервера — и
 * сообщает, на какой адрес он встал, и порядок резолва DNS в субпроцессе.
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
