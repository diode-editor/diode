"use strict";

/**
 * The answer is printed to Output: the toast shows the question, but whether the clicked button made it back to
 * the extension is visible only by the extension's own trace.
 */

/** How the answer is printed: closing without a choice is a separate outcome. */
function describe(value) {
    if (value === undefined) return "закрыто без выбора";
    if (typeof value === "string") return value;
    return "item:" + value.title;
}

exports.activate = function activate(context) {
    const vscode = require("vscode");

    const channel = vscode.window.createOutputChannel("Diode Notify");
    context.subscriptions.push(channel);
    channel.show(true);

    const register = function (id, run) {
        context.subscriptions.push(vscode.commands.registerCommand(id, run));
    };


    register("diodeNotify.info", function () {
        vscode.window.showInformationMessage("Ruff: formatted 3 files");
    });

    register("diodeNotify.warning", function () {
        vscode.window.showWarningMessage("ESLint: config not found, using defaults");
    });

    register("diodeNotify.error", function () {
        vscode.window.showErrorMessage("tsserver: crashed 3 times in the last minute");
    });

    register("diodeNotify.many", function () {
        vscode.window.showInformationMessage("Message one");
        vscode.window.showInformationMessage("Message two");
        vscode.window.showInformationMessage("Message three");
        vscode.window.showInformationMessage("Message four");
        vscode.window.showInformationMessage("Message five");
    });

    // A message without buttons must NOT hang the extension: the promise resolves
    // right on show, and this line appears in Output immediately.
    register("diodeNotify.awaitError", async function () {
        const answer = await vscode.window.showErrorMessage("Sticky error stays on screen");
        channel.appendLine("Await error returned: " + describe(answer));
    });


    // Verbatim the Supermaven case: the only door to the extension's sign-up.
    register("diodeNotify.ask", async function () {
        const answer = await vscode.window.showWarningMessage(
            "Thank you for installing Supermaven! Click 'Activate' to set up a Supermaven Pro subscription, or click 'Use free version' to use the Free Tier",
            "Activate",
            "Use free version",
        );
        channel.appendLine("Ask returned: " + describe(answer));
    });

    // Buttons as objects (`MessageItem`), not strings: the extension must
    // get back ITS OWN object, not one rebuilt over the wire.
    register("diodeNotify.askItems", async function () {
        const retry = { title: "Retry" };
        const cancel = { title: "Cancel", isCloseAffordance: true };
        const answer = await vscode.window.showErrorMessage("Upload failed", retry, cancel);
        channel.appendLine("Items returned: " + describe(answer) + (answer === retry ? " (same object)" : ""));
    });

    register("diodeNotify.askModal", async function () {
        const answer = await vscode.window.showWarningMessage(
            "Delete 12 files permanently?",
            { modal: true, detail: "Это действие нельзя отменить." },
            "Delete",
            { title: "Cancel", isCloseAffordance: true },
        );
        channel.appendLine("Modal returned: " + describe(answer));
    });

    // Two questions in a row: the second waits its turn until the first is answered.
    register("diodeNotify.askTwice", function () {
        void vscode.window.showInformationMessage("First question", "One").then(function (answer) {
            channel.appendLine("First returned: " + describe(answer));
        });
        void vscode.window.showInformationMessage("Second question", "Two").then(function (answer) {
            channel.appendLine("Second returned: " + describe(answer));
        });
    });


    register("diodeNotify.openExternal", async function () {
        const opened = await vscode.env.openExternal(vscode.Uri.parse("https://example.com/activate?token=42"));
        channel.appendLine("openExternal returned: " + String(opened));
    });

    register("diodeNotify.clipboard", async function () {
        await vscode.env.clipboard.writeText("clipboard-from-extension");
        const text = await vscode.env.clipboard.readText();
        channel.appendLine("clipboard readText: " + text);
    });
};
