"use strict";

/** Расширение ленивое (`onUri`): обработчик заводится на активации. */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.window.registerUriHandler({
            handleUri(uri) {
                vscode.window.showInformationMessage("URI handled: " + uri.path + "?" + uri.query);
            },
        }),
    );
};
