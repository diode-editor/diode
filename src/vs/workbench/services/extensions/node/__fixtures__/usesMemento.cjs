"use strict";

/**
 * Фикстура для extensionHost.memento.test.ts. Как настоящий потребитель
 * `globalState`/`workspaceState` (ruff помечает разово показанную рекомендацию):
 * в `activate()` СРАЗУ читает memento синхронно, а дальше пишет через `update`.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const scope = (shared) => (shared ? context.globalState : context.workspaceState);
    const shownAtActivate = context.globalState.get("shown", false);

    const register = (id, handler) => {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    };

    register("test.memento.shownAtActivate", () => shownAtActivate);
    register("test.memento.get", (shared, key) => {
        const value = scope(shared).get(key);
        return value === undefined ? null : value;
    });
    register("test.memento.update", async (shared, key, value) => {
        await scope(shared).update(key, value === null ? undefined : value);
        return null;
    });
    register("test.memento.keys", (shared) => [...scope(shared).keys()]);
};
