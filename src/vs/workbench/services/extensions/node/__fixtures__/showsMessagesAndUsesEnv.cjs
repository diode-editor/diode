"use strict";

/**
 * Фикстура для extensionHost.notificationsSubprocess.test.ts — полный круг
 * `window.show*Message` и `env.*` через НАСТОЯЩИЙ субпроцесс.
 *
 * Команды возвращают то, что расширение получило обратно, — значение команды и
 * есть сигнал наружу (принятая конвенция фикстур).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.commands.registerCommand("test.askWithButtons", async function () {
            const picked = await vscode.window.showInformationMessage(
                "Activate a Pro subscription?",
                "Activate",
                "Use free version",
            );
            return picked === undefined ? "dismissed" : "picked:" + picked;
        }),
        // Перегрузка с MessageItem: расширение обязано получить обратно СВОЙ объект.
        vscode.commands.registerCommand("test.askWithMessageItems", async function () {
            const retry = { title: "Retry" };
            const cancel = { title: "Cancel", isCloseAffordance: true };
            const picked = await vscode.window.showErrorMessage("Language server crashed", retry, cancel);
            if (picked === undefined) return "dismissed";
            return picked === retry ? "same-object:Retry" : "copy:" + picked.title;
        }),
        // MessageOptions первым аргументом: не пункт, обратно приехать не должен.
        vscode.commands.registerCommand("test.askModal", async function () {
            const picked = await vscode.window.showWarningMessage(
                "Discard changes?",
                { modal: true, detail: "Unsaved edits will be lost" },
                "Discard",
            );
            return picked === undefined ? "dismissed" : "picked:" + picked;
        }),
        vscode.commands.registerCommand("test.clipboardRoundTrip", async function () {
            await vscode.env.clipboard.writeText("from extension");
            return "read:" + (await vscode.env.clipboard.readText());
        }),
        vscode.commands.registerCommand("test.openLink", async function () {
            const opened = await vscode.env.openExternal(
                vscode.Uri.parse("https://example.com/activate?token=demo"),
            );
            return "opened:" + String(opened);
        }),
    );
};
