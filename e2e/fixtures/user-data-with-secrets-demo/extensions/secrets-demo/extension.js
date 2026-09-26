"use strict";

/**
 * Демо двух вещей сразу, потому что в живом расширении они и ходят парой: то,
 * что AI-автодополнение делает первыми строками `activate()` — читает свой
 * токен и осматривает соседей.
 *
 * 1. `ExtensionContext.secrets`. Токен читается СРАЗУ: по его наличию
 *    расширение решает, спрашивать ли человека. В этом user-data он уже лежит
 *    (`user-data/User/secrets.json` фикстуры) — то есть достался «от прошлого
 *    запуска», чего memento бы не пережил. Дальше `store`/`delete` меняют его
 *    на живую, а счётчик `onDidChange` показывает, что событие доезжает.
 *
 * 2. `vscode.extensions`. `getExtension(id)` про себя и про заведомо
 *    отсутствующего соседа, плюс весь `all` — в канал Output.
 *
 * Значение токена здесь печатается НАМЕРЕННО: это выдуманное демо-значение
 * фикстуры, и только по нему на кадре видно, что секрет доехал целиком, а не
 * «что-то есть». В самом diode значения секретов не логируются нигде.
 *
 * Используется e2e-сценарием extensionSecrets и ручной проверкой:
 *   diode --user-data-dir=<каталог с этой фикстурой> <какой-нибудь файл>
 */
exports.activate = async function activate(context) {
    const vscode = require("vscode");

    const out = vscode.window.createOutputChannel("Secrets Demo");

    // Та самая строка, ради которой поле и заводилось.
    let token = await context.secrets.get("token");
    let changes = 0;

    // Два пункта, а не один: текст пункта расширения обрезается на 24 глифах
    // (MAX_ITEM_WIDTH в ExtensionStatusBarAdapter), а показать надо и токен,
    // и счётчик событий.
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

    // Перечитываем по событию, а не по возврату store/delete: так расширение и
    // узнаёт о чужой правке своего секрета.
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
        // Соседа, которого нет, по-прежнему нет — это тоже часть контракта.
        out.appendLine("getExtension(ms-python.python): " + String(vscode.extensions.getExtension("ms-python.python")));
        out.appendLine("extensions.all: " + vscode.extensions.all.map((e) => e.id + "=" + e.isActive).join(", "));
        out.appendLine("secrets.keys: " + (await context.secrets.keys()).join(", "));
        out.show();
    });
};
