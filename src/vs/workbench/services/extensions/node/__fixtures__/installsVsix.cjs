"use strict";

/**
 * Fixture for extensionHost.installFromVsix.test.ts: how CodeLLDB installs its platform package —
 * `executeCommand("workbench.extensions.command.installFromVSIX", [Uri.file(path)])`. Command
 * `test.installVsix` returns "installed" or the rejection's message, as CodeLLDB shows it.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.commands.registerCommand("test.installVsix", async (vsixPath) => {
            try {
                await vscode.commands.executeCommand("workbench.extensions.command.installFromVSIX", [
                    vscode.Uri.file(vsixPath),
                ]);
                return "installed";
            } catch (err) {
                return `failed: ${err instanceof Error ? err.message : String(err)}`;
            }
        }),
    );
};
