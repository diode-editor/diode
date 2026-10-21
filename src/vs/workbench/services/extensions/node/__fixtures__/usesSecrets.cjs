"use strict";

/**
 * Fixture for extensionHost.secrets.test.ts. Follows the path of a real
 * `ExtensionContext.secrets` consumer (Codeium/Tabnine keep their service token
 * there): `activate()` reads the secret RIGHT AWAY (the extension uses it to decide
 * whether to ask the user) and subscribes to `onDidChange`.
 *
 * `activate()` has no try/catch on purpose: a missing field must fail
 * the activation so the test sees it.
 */
exports.activate = async function activate(context) {
    const vscode = require("vscode");

    // The very line where the extension would crash without the field.
    const tokenAtActivate = await context.secrets.get("token");
    /** `onDidChange` events in arrival order: KEYS only, no values here. */
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
