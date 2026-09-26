"use strict";

/**
 * Демо двух вещей сразу, потому что в живом расширении они и ходят парой.
 *
 * 1. Каталоги хранения (`ExtensionContext.globalStorageUri` / `storageUri` /
 *    `logUri`). Расширение делает в `activate()` ровно то, что делают
 *    AI-автодополнения: читает `globalStorageUri.fsPath`, создаёт каталог сам
 *    (родителя гарантирует хост) и пишет туда файл — сюда же такие расширения
 *    кладут скачанный движок. Счётчик запусков в статус-баре доказывает, что
 *    запись доехала: он прочитан из файла в globalStorage.
 *
 * 2. Команда `setContext`. Расширение объявило свой кейбинд `alt+q` под
 *    `when: "extStorageDemo.armed"`. Пока ключ не выставлен, клавиша мертва;
 *    после `Arm` она исполняет команду расширения, после `Disarm` снова мертва.
 *
 * Используется e2e-сценарием extensionStorage и ручной проверкой:
 *   diode --user-data-dir=<каталог с этой фикстурой> <какой-нибудь файл>
 */
const fs = require("node:fs");
const path = require("node:path");

exports.activate = function activate(context) {
    const vscode = require("vscode");

    const out = vscode.window.createOutputChannel("Ext Storage Demo");

    // Каталог расширения создаём САМИ — по контракту API хост гарантирует только
    // родителя. Та самая строка, на которой расширения падали без поля.
    const globalDir = context.globalStorageUri.fsPath;
    fs.mkdirSync(globalDir, { recursive: true });
    const runsFile = path.join(globalDir, "runs.json");
    let runs = 0;
    try {
        runs = JSON.parse(fs.readFileSync(runsFile, "utf-8")).runs;
    } catch {
        runs = 0;
    }
    runs += 1;
    fs.writeFileSync(runsFile, JSON.stringify({ runs }), "utf-8");

    out.appendLine("globalStorageUri: " + globalDir);
    out.appendLine("storageUri: " + (context.storageUri === undefined ? "(нет: папка не открыта)" : context.storageUri.fsPath));
    out.appendLine("logUri: " + context.logUri.fsPath);
    out.appendLine("runs.json прочитан и перезаписан: runs=" + runs);

    // Два пункта, а не один: текст пункта расширения обрезается на 24 глифах
    // (MAX_ITEM_WIDTH в ExtensionStatusBarAdapter), а показать надо и счётчик
    // запусков из globalStorage, и состояние when-ключа.
    let fired = 0;
    let armed = false;
    const storageItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
    storageItem.name = "Ext Storage Demo: storage";
    storageItem.text = "Storage run " + runs;
    storageItem.show();

    // Состояние ключа печатаем в текст пункта НЕ для красоты: сценарию нужен
    // наблюдаемый сигнал «setContext уже доехал», иначе нажатие клавиши
    // обгоняет RPC и демо становится гонкой.
    const gateItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    gateItem.name = "Ext Storage Demo: gate";
    const render = () => {
        gateItem.text = (armed ? "armed" : "idle") + " · fired " + fired;
    };
    render();
    gateItem.show();
    context.subscriptions.push(storageItem, gateItem, out);

    const register = (id, handler) => {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    };

    // Команда под кейбиндом: её `when` гейтит наш же контекст-ключ.
    register("extStorageDemo.fire", () => {
        fired += 1;
        render();
    });
    const setArmed = async (value) => {
        await vscode.commands.executeCommand("setContext", "extStorageDemo.armed", value);
        armed = value;
        render();
    };
    register("extStorageDemo.arm", () => setArmed(true));
    register("extStorageDemo.disarm", () => setArmed(false));
    register("extStorageDemo.showPaths", () => {
        out.show();
    });
};
