"use strict";

/**
 * Fixture for extensionHost.tasksConfiguration.test.ts. Writes the `tasks` section the way the upstream API test
 * does (`getConfiguration("tasks").update("tasks", [...], ConfigurationTarget.Workspace)`) and reports what
 * `get`/`inspect` see right after `await update()`, plus how many `onDidChangeConfiguration` events affected `tasks`.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    let changes = 0;
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("tasks")) changes++;
        }),
    );
    // `null` removes the key or omits the target (a command cannot pass `undefined`).
    context.subscriptions.push(
        vscode.commands.registerCommand("test.tasks.update", async (key, value, target) => {
            try {
                await vscode.workspace
                    .getConfiguration("tasks")
                    .update(key, value === null ? undefined : value, target === null ? undefined : target);
            } catch (error) {
                return { error: error instanceof Error ? error.message : String(error) };
            }
            const after = vscode.workspace.getConfiguration("tasks");
            const reported = changes;
            changes = 0;
            return {
                version: after.get("version") ?? null,
                tasks: after.get("tasks") ?? null,
                workspaceValue: after.inspect("tasks")?.workspaceValue ?? null,
                globalValue: after.inspect("tasks")?.globalValue ?? null,
                changes: reported,
            };
        }),
        vscode.commands.registerCommand("test.tasks.read", () => {
            const reported = changes;
            changes = 0;
            return { tasks: vscode.workspace.getConfiguration("tasks").get("tasks") ?? null, changes: reported };
        }),
    );
};
