"use strict";

/**
 * Fixture for extensionHost.uriHandler.test.ts: a lazy (`onUri`) extension
 * registers a URI handler on activation, like the stock extension `Anthropic.claude-code`
 * (`/install-plugin`), and collects the received URIs for a probe command.
 */
const vscode = require("vscode");

exports.activate = function activate(context) {
    const received = [];
    context.subscriptions.push(
        vscode.window.registerUriHandler({
            handleUri(uri) {
                received.push({ path: uri.path, query: uri.query });
            },
        }),
        vscode.commands.registerCommand("test.uri.received", function () {
            return received;
        }),
        vscode.commands.registerCommand("test.uri.registerAgain", function () {
            try {
                vscode.window.registerUriHandler({ handleUri() {} });
                return "registered";
            } catch (err) {
                return err.message;
            }
        }),
    );
};
