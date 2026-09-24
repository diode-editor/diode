"use strict";

/**
 * Демо-расширение статус-бара: показывает всё, что даёт
 * `window.createStatusBarItem` — пункт с командой по клику, живой текст,
 * show/hide/dispose, значки `$(name)`, стороны и приоритеты.
 *
 * Используется e2e-сценарием statusBarExtension и ручной проверкой:
 *   diode --user-data-dir=<каталог с этой фикстурой> <какой-нибудь файл>
 *
 * Команды вызываются из палитры по F1 — их заголовки объявлены в package.json
 * (`contributes.commands`), иначе рантайм-регистрация в палитре не видна.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    // Главный пункт: справа, кликабелен, счётчик кликов ведёт само расширение.
    const demo = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    demo.name = "Status Bar Demo";
    demo.text = "Demo";
    demo.command = "statusBarDemo.click";
    demo.show();

    let clicks = 0;
    /** Пункт, созданный командой Create Hidden (создан, но не показан). */
    let hidden = null;

    const register = (id, handler) => {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    };

    register("statusBarDemo.click", () => {
        clicks += 1;
        demo.text = "Demo · clicked " + clicks;
    });
    register("statusBarDemo.setText", () => {
        demo.text = "Demo 42";
    });
    register("statusBarDemo.setTooltip", () => {
        demo.tooltip = "Подсказка демо-расширения";
    });
    // Прячет последний созданный пункт: `Hidden Demo`, если он есть, иначе сам
    // `Demo`. Так команда всегда относится к тому пункту, о котором идёт речь.
    register("statusBarDemo.hide", () => {
        if (hidden !== null) hidden.hide();
        else demo.hide();
    });
    register("statusBarDemo.createHidden", () => {
        if (hidden !== null) hidden.dispose();
        hidden = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
        hidden.name = "Status Bar Demo Hidden";
        hidden.text = "Hidden Demo";
        // show() намеренно НЕ зовём: пункт создан, но в полосе его нет.
    });
    register("statusBarDemo.showHidden", () => {
        if (hidden === null) return;
        hidden.show();
    });
    register("statusBarDemo.dispose", () => {
        demo.dispose();
    });
    register("statusBarDemo.createLeftPair", () => {
        const high = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        high.name = "Status Bar Demo L-high";
        high.text = "L-high";
        high.show();
        const low = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
        low.name = "Status Bar Demo L-low";
        low.text = "L-low";
        low.show();
        context.subscriptions.push(high, low);
    });
    register("statusBarDemo.createNoPriority", () => {
        const plain = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        plain.name = "Status Bar Demo L-none";
        plain.text = "L-none";
        plain.show();
        context.subscriptions.push(plain);
    });
    register("statusBarDemo.iconText", () => {
        demo.text = "$(check) Demo";
    });
    register("statusBarDemo.iconOnly", () => {
        demo.text = "$(sync~spin)";
    });
    register("statusBarDemo.longText", () => {
        demo.text = "Long ".repeat(40).trim();
    });
    register("statusBarDemo.killHost", () => {
        // Отложенный выход: ответ на вызов команды должен успеть уйти редактору.
        setTimeout(() => process.exit(1), 10);
    });

    context.subscriptions.push(demo);
};
