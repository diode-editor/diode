"use strict";

/**
 * Демо `window.registerUriHandler` (сценарий extension-uri-handler): расширение
 * ленивое (`onUri`), обработчик заводит на активации и показывает полученный
 * путь с запросом тостом.
 */
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
