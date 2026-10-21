"use strict";

/**
 * Каталоги хранения и `setContext` — в живом расширении они ходят парой. Как AI-автодополнения,
 * `activate()` пишет файл в `globalStorageUri` (туда такие расширения кладут скачанный движок);
 * счётчик запусков в статус-баре прочитан из него. Кейбинд `alt+q` — под `when: "extStorageDemo.armed"`.
 */
const fs = require("node:fs");
const path = require("node:path");

exports.activate = function activate(context) {
    const vscode = require("vscode");

    const out = vscode.window.createOutputChannel("Ext Storage Demo");

    // Каталог создаём САМИ: хост гарантирует только родителя. На этой строке расширения падали без поля.
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
