"use strict";

/**
 * Фикстура для extensionHost.storagePaths.test.ts. Повторяет то, что делает
 * настоящее AI-автодополнение (Supermaven) в своём activate(): читает
 * `context.globalStorageUri.fsPath` СРАЗУ, ещё до всякого UI, создаёт каталог
 * сам (по контракту vscode.d.ts это его дело — хост гарантирует только
 * родителя) и пишет туда файл, как в тот каталог кладут скачанный движок.
 *
 * `activate()` намеренно НЕ защищён try/catch: отсутствующее поле должно
 * ронять активацию, чтобы тест это видел.
 */
const fs = require("node:fs");
const path = require("node:path");

exports.activate = function activate(context) {
    const vscode = require("vscode");

    // Та самая строка, на которой расширение падало без поля.
    const engineDir = context.globalStorageUri.fsPath;
    fs.mkdirSync(engineDir, { recursive: true });
    fs.writeFileSync(path.join(engineDir, "sm-agent"), "скачанный движок", "utf-8");

    context.subscriptions.push(
        vscode.commands.registerCommand("test.storage.report", function () {
            return {
                globalStorageFsPath: context.globalStorageUri.fsPath,
                globalStorageScheme: context.globalStorageUri.scheme,
                globalStoragePath: context.globalStoragePath,
                storageFsPath: context.storageUri === undefined ? null : context.storageUri.fsPath,
                storagePath: context.storagePath === undefined ? null : context.storagePath,
                logFsPath: context.logUri.fsPath,
                logPath: context.logPath,
                // Каталоги логов/воркспейса расширение себе не создавало —
                // тест проверяет, что существует именно РОДИТЕЛЬ.
                logParentExists: fs.existsSync(path.dirname(context.logUri.fsPath)),
                logDirExists: fs.existsSync(context.logUri.fsPath),
            };
        }),
    );
};
