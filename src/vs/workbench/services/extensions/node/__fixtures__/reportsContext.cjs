"use strict";

/**
 * Фикстура для extensionHost.context.test.ts. Регистрирует команду
 * `test.context.report`, которая возвращает поля ExtensionContext (пути,
 * режим, asAbsolutePath) и env-флаги субпроцесса — тест проверяет, что host
 * передал корень установки расширения и что окружение детей очищено от
 * `DIODE_EXTENSION_HOST` (см. env-фикс в runExtensionHostSubprocess).
 */
const path = require("node:path");

exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.commands.registerCommand("test.context.report", function () {
            return {
                extensionPath: context.extensionPath,
                extensionUriFsPath: context.extensionUri.fsPath,
                extensionMode: context.extensionMode,
                isProduction: context.extensionMode === vscode.ExtensionMode.Production,
                serverPath: context.asAbsolutePath(path.join("dist", "server.js")),
                envExtensionHost: process.env.DIODE_EXTENSION_HOST ?? null,
                envRunAsNode: process.env.DIODE_RUN_AS_NODE ?? null,
                pylance: vscode.extensions.getExtension("ms-python.vscode-pylance") ?? null,
                allExtensions: vscode.extensions.all,
            };
        }),
    );
};
