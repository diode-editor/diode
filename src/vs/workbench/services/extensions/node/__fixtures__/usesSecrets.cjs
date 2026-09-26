"use strict";

/**
 * Фикстура для extensionHost.secrets.test.ts. Повторяет путь настоящего
 * потребителя `ExtensionContext.secrets` (Codeium/Tabnine хранят там токен
 * сервиса): в `activate()` СРАЗУ читает секрет — расширение решает по нему,
 * спрашивать ли человека, — и подписывается на `onDidChange`.
 *
 * `activate()` намеренно без try/catch: отсутствующее поле должно ронять
 * активацию, чтобы тест это видел.
 */
exports.activate = async function activate(context) {
    const vscode = require("vscode");

    // Та самая строка, на которой расширение падало бы без поля.
    const tokenAtActivate = await context.secrets.get("token");
    /** События `onDidChange` в порядке прихода — только КЛЮЧИ, значений тут нет. */
    const changes = [];
    context.subscriptions.push(
        context.secrets.onDidChange(function (event) {
            changes.push(event.key);
        }),
    );

    const register = (id, handler) => {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    };

    register("test.secrets.tokenAtActivate", () => (tokenAtActivate === undefined ? null : tokenAtActivate));
    register("test.secrets.get", async (key) => {
        const value = await context.secrets.get(key);
        return value === undefined ? null : value;
    });
    register("test.secrets.store", async (key, value) => {
        await context.secrets.store(key, value);
        return null;
    });
    register("test.secrets.delete", async (key) => {
        await context.secrets.delete(key);
        return null;
    });
    register("test.secrets.keys", () => context.secrets.keys());
    register("test.secrets.changes", () => changes.slice());
};
