"use strict";

/**
 * Фикстура для extensionHost.quickInputSubprocess.test.ts — полный круг
 * `window.showInputBox` / `window.showQuickPick` через НАСТОЯЩИЙ субпроцесс.
 *
 * Команды возвращают то, что расширение получило от человека, — значение
 * команды и есть сигнал наружу (принятая конвенция фикстур).
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.commands.registerCommand("test.askName", async function () {
            const value = await vscode.window.showInputBox({
                title: "Your name",
                prompt: "Как к вам обращаться",
                placeHolder: "имя",
                validateInput: function (text) {
                    return text === "плохо" ? "Так нельзя" : null;
                },
            });
            return value === undefined ? "cancelled" : "got:" + value;
        }),
        vscode.commands.registerCommand("test.pickFruit", async function () {
            const value = await vscode.window.showQuickPick(["apple", "banana", "cherry"], {
                placeHolder: "Выберите фрукт",
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
