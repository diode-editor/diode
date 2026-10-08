"use strict";

/**
 * Фикстура для extensionHost.configurationUpdate.test.ts. Пишет настройку так
 * же, как стоковый Bazel-плагин (`getConfiguration("bazel.projectview")
 * .update("open", false)`), и сразу после `await update()` читает её обратно —
 * эталон обещает, что к этому моменту `get()` уже видит новое значение.
 * `onDidChangeConfiguration` копит события, затронувшие `test.update`.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const changes = [];
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("test.update")) changes.push(event.affectsConfiguration("test.update.open"));
        }),
    );
    // (section, key, value, target): value `null` — снять ключ (`undefined` по команде не передать).
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
