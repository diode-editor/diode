"use strict";

/**
 * Фикстура для extensionHost.setContext.test.ts. Публикует свой when-ключ ровно
 * так, как это делают сторонние расширения: `executeCommand("setContext", key,
 * value)` из activate() и из своей команды. Ключ точечный (`publisher.thing`) —
 * другого вида имён у расширений практически не бывает.
 */
exports.activate = async function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.commands.registerCommand("test.setctx.arm", function () {
            return vscode.commands.executeCommand("setContext", "testExt.armed", true);
        }),
        vscode.commands.registerCommand("test.setctx.disarm", function () {
            return vscode.commands.executeCommand("setContext", "testExt.armed", false);
        }),
        vscode.commands.registerCommand("test.setctx.setMode", function (mode) {
            return vscode.commands.executeCommand("setContext", "testExt.mode", mode);
        }),
    );

    // Активационный вызов: у Supermaven `setContext` летит именно отсюда.
    await vscode.commands.executeCommand("setContext", "testExt.activated", true);
};
