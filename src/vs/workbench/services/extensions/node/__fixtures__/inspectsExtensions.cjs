"use strict";

/**
 * Fixture for extensionHost.extensionsCatalog.test.ts. Mirrors the path of
 * AI autocompletion: in `activate()` it IMMEDIATELY detects neighbors via
 * `extensions.getExtension(id)` (the Supermaven bundle has four such calls) and
 * subscribes to changes in the extension set.
 *
 * Returns a public API (`exports`), used to check that a neighbor can reach it
 * via `getExtension(id).exports`.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    /** Neighbor snapshot at activate() time: the extension set must be correct already here. */
    const selfAtActivate = describe(vscode.extensions.getExtension("test.inspector"));
    let changeCount = 0;
    context.subscriptions.push(
        vscode.extensions.onDidChange(function () {
            changeCount += 1;
        }),
    );

    function describe(extension) {
        if (extension === undefined) return null;
        return {
            id: extension.id,
            extensionPath: extension.extensionPath,
            extensionUriFsPath: extension.extensionUri.fsPath,
            isActive: extension.isActive,
            extensionKind: extension.extensionKind,
            isUiKind: extension.extensionKind === vscode.ExtensionKind.UI,
            packageJSONName: extension.packageJSON.name,
            packageJSONDisplayName: extension.packageJSON.displayName,
            exports: extension.exports === undefined ? null : extension.exports,
        };
    }

    const register = (id, handler) => {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    };

    register("test.extensions.selfAtActivate", () => selfAtActivate);
    register("test.extensions.all", () => vscode.extensions.all.map(describe));
    register("test.extensions.get", (id) => describe(vscode.extensions.getExtension(id)));
    register("test.extensions.changeCount", () => changeCount);
    register("test.extensions.activateNeighbour", async (id) => {
        const neighbour = vscode.extensions.getExtension(id);
        if (neighbour === undefined) return { ok: false, error: "not found" };
        try {
            return { ok: true, value: await neighbour.activate() };
        } catch (err) {
            return { ok: false, error: String(err && err.message ? err.message : err) };
        }
    });

    return { hello: "from inspector" };
};
