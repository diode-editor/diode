"use strict";

/**
 * Фикстура для extensionHost.context.test.ts. Регистрирует команду
 * `test.context.report`, которая возвращает поля ExtensionContext (пути,
 * режим, asAbsolutePath, запись `extension` из каталога) и env-флаги
 * субпроцесса — тест проверяет, что host
 * передал корень установки расширения и что окружение детей очищено от
 * `DIODE_EXTENSION_HOST` (см. env-фикс в runExtensionHostSubprocess).
 */
const path = require("node:path");

exports.activate = function activate(context) {
    const vscode = require("vscode");
    // `context.extension` — то, что телеметрии читают первой строкой activate()
    // (`context.extension.packageJSON.version`). Снимок берём ЗДЕСЬ: `isActive`
    // во время собственной активации обязан быть false, как в эталоне.
    const selfAtActivate = {
        id: context.extension.id,
        packageJSON: context.extension.packageJSON,
        extensionPath: context.extension.extensionPath,
        isActive: context.extension.isActive,
    };
    context.subscriptions.push(
        vscode.commands.registerCommand("test.context.report", function () {
            return {
                selfAtActivate,
                selfIsActiveNow: context.extension.isActive,
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
