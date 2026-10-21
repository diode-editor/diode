"use strict";

/**
 * The first lines of an AI autocompletion extension's `activate()`: it reads its token and inspects
 * its neighbors. The token is already in the fixture's `user-data/User/secrets.json` ("from a previous
 * run"), which a memento wouldn't survive. The value is printed ON PURPOSE: it's made up, and only it
 * shows in the frame that the secret arrived intact. Diode itself never logs secret values anywhere.
 */
exports.activate = async function activate(context) {
    const vscode = require("vscode");

    const out = vscode.window.createOutputChannel("Secrets Demo");

    let token = await context.secrets.get("token");
    let changes = 0;

    // Two items, not one: an extension item's text is truncated at 24 glyphs
    // (MAX_ITEM_WIDTH in ExtensionStatusBarAdapter), and both the token and
    // the event counter must be shown.
    const tokenItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
    tokenItem.name = "Secrets Demo: token";
    const changesItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    changesItem.name = "Secrets Demo: changes";
    const render = () => {
        tokenItem.text = "token " + (token === undefined ? "none" : token);
        changesItem.text = "changes " + changes;
    };
    render();
    tokenItem.show();
    changesItem.show();
    context.subscriptions.push(tokenItem, changesItem, out);

    // Re-read on the event, not on store/delete returning: that's also how the
    // extension learns about someone else's edit of its secret.
    context.subscriptions.push(
        context.secrets.onDidChange(async function (event) {
            if (event.key !== "token") return;
            changes += 1;
            token = await context.secrets.get("token");
            render();
        }),
    );

    const register = (id, handler) => {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    };

    register("secretsDemo.store", () => context.secrets.store("token", "rotated"));
    register("secretsDemo.delete", () => context.secrets.delete("token"));
    register("secretsDemo.showCatalog", async () => {
        const self = vscode.extensions.getExtension("test.secrets-demo");
        out.appendLine("getExtension(test.secrets-demo).isActive: " + String(self && self.isActive));
        out.appendLine("getExtension(test.secrets-demo).packageJSON.displayName: " + self.packageJSON.displayName);
        out.appendLine("extensionKind === UI: " + String(self.extensionKind === vscode.ExtensionKind.UI));
        // A missing neighbor is still missing: that's part of the contract too.
        out.appendLine("getExtension(ms-python.python): " + String(vscode.extensions.getExtension("ms-python.python")));
        out.appendLine("extensions.all: " + vscode.extensions.all.map((e) => e.id + "=" + e.isActive).join(", "));
        out.appendLine("secrets.keys: " + (await context.secrets.keys()).join(", "));
        out.show();
    });
};
