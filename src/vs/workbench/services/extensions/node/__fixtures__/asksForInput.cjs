"use strict";

/**
 * Fixture for extensionHost.quickInputSubprocess.test.ts: the full round trip of
 * `window.showInputBox` / `window.showQuickPick` through a REAL subprocess.
 *
 * Commands return what the extension got from the user: the command's value is
 * the signal to the outside (the established fixture convention).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.commands.registerCommand("test.askName", async function () {
            const value = await vscode.window.showInputBox({
                title: "Your name",
                prompt: "How should we address you",
                placeHolder: "name",
                validateInput: function (text) {
                    return text === "bad" ? "Not allowed" : null;
                },
            });
            return value === undefined ? "cancelled" : "got:" + value;
        }),
        vscode.commands.registerCommand("test.pickFruit", async function () {
            const value = await vscode.window.showQuickPick(["apple", "banana", "cherry"], {
                placeHolder: "Pick a fruit",
            });
            return value === undefined ? "cancelled" : "got:" + value;
        }),
        vscode.commands.registerCommand("test.pickMany", async function () {
            const picked = await vscode.window.showQuickPick(
                [{ label: "alpha" }, { label: "beta", picked: true }, { label: "gamma" }],
                { canPickMany: true },
            );
            if (picked === undefined) return "cancelled";
            return (
                "got:" +
                picked
                    .map(function (item) {
                        return item.label;
                    })
                    .join(",")
            );
        }),
    );
};
