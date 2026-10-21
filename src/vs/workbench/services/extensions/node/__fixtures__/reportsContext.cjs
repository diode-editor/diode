"use strict";

/**
 * Fixture for extensionHost.context.test.ts. Registers the
 * `test.context.report` command, which returns ExtensionContext fields (paths,
 * mode, asAbsolutePath, the `extension` entry from the catalog) and the subprocess
 * env flags; the test checks that the host
 * passed the extension's install root and that the children's environment is cleared of
 * `DIODE_EXTENSION_HOST` (see the env fix in runExtensionHostSubprocess).
 */
const path = require("node:path");

exports.activate = function activate(context) {
    const vscode = require("vscode");
    // `context.extension` is what telemetry reads on the first line of activate()
    // (`context.extension.packageJSON.version`). The snapshot is taken HERE: `isActive`
    // must be false during its own activation, as in upstream.
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
