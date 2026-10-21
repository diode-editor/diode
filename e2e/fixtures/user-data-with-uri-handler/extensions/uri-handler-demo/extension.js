"use strict";

/** The extension is lazy (`onUri`): the handler is registered on activation. */
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
