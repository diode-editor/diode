"use strict";

/**
 * Fixture for extensionHost.configurationUpdate.test.ts. Writes a setting the same
 * way the stock Bazel plugin does (`getConfiguration("bazel.projectview")
 * .update("open", false)`), and right after `await update()` reads it back:
 * upstream promises that by then `get()` already sees the new value.
 * `onDidChangeConfiguration` collects events that affect `test.update`.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const changes = [];
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("test.update")) changes.push(event.affectsConfiguration("test.update.open"));
        }),
    );
    // (section, key, value, target): `null` removes the key (a command cannot pass `undefined`).
    context.subscriptions.push(
        vscode.commands.registerCommand("test.config.update", async (section, key, value, target) => {
            const config = vscode.workspace.getConfiguration(section);
            try {
                await config.update(key, value === null ? undefined : value, target === null ? undefined : target);
            } catch (error) {
                return { error: error instanceof Error ? error.message : String(error) };
            }
            const after = vscode.workspace.getConfiguration(section);
            const inspect = after.inspect(key);
            return {
                value: after.get(key) ?? null,
                globalValue: inspect.globalValue ?? null,
                workspaceValue: inspect.workspaceValue ?? null,
                changes: changes.splice(0),
            };
        }),
    );
};
