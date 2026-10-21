"use strict";

/**
 * Fixture for extensionHost.storagePaths.test.ts. Repeats what a real
 * AI autocompletion (Supermaven) does in its activate(): reads
 * `context.globalStorageUri.fsPath` RIGHT AWAY, before any UI, creates the directory
 * itself (per the vscode.d.ts contract that is its job; the host only guarantees
 * the parent) and writes a file there, the way a downloaded engine is put into that directory.
 *
 * `activate()` is deliberately NOT guarded by try/catch: a missing field must
 * fail the activation so the test sees it.
 */
const fs = require("node:fs");
const path = require("node:path");

exports.activate = function activate(context) {
    const vscode = require("vscode");

    // The very line where the extension crashed without the field.
    const engineDir = context.globalStorageUri.fsPath;
    fs.mkdirSync(engineDir, { recursive: true });
    fs.writeFileSync(path.join(engineDir, "sm-agent"), "downloaded engine", "utf-8");

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
                // The extension did not create the log/workspace directories itself:
                // the test checks that exactly the PARENT exists.
                logParentExists: fs.existsSync(path.dirname(context.logUri.fsPath)),
                logDirExists: fs.existsSync(context.logUri.fsPath),
            };
        }),
    );
};
