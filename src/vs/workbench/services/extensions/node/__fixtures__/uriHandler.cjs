"use strict";

/**
 * Фикстура для extensionHost.uriHandler.test.ts: ленивое (`onUri`) расширение
 * заводит обработчик URI на активации, как стоковое `Anthropic.claude-code`
 * (`/install-plugin`), и копит полученные URI для команды-проверки.
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
