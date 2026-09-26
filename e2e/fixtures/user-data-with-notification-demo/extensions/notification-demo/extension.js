"use strict";

/**
 * Демо-расширение сообщений: показывает всё, ради чего существует
 * `window.show*Message` с кнопками, и оба члена `env`, которые на нём стоят.
 *
 * Ответ человека расширение печатает В ПОЛОСУ СТАТУСА: обещание
 * `showInformationMessage` резолвится тем, что нажали, и это единственный способ
 * увидеть на кадре, что ответ доехал обратно в код расширения — сам тост к этому
 * моменту уже закрыт.
 *
 * Используется e2e-сценарием notifications и ручной проверкой:
 *   diode --user-data-dir=<каталог с этой фикстурой> <какой-нибудь файл>
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    // Табло ответов: сюда уезжает то, что вернули обещания сообщений.
    const answer = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    answer.name = "Notification Demo";
    answer.text = "no answer";
    answer.show();
    context.subscriptions.push(answer);

    const show = (text) => {
        answer.text = text;
    };

    const register = (id, handler) => {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    };

    /**
     * Вопрос с двумя кнопками — ровно та форма, которой стоковые AI-автокомплиты
     * спрашивают про регистрацию (у Supermaven команды в палитре для этого нет).
     */
    const ask = async () => {
        const picked = await vscode.window.showInformationMessage(
            "Thank you for installing! Click Activate to set up a Pro subscription, or use the free version.",
            "Activate",
            "Use free version",
        );
        show(picked === undefined ? "dismissed" : "picked " + picked);
    };

    register("notificationDemo.ask", ask);

    register("notificationDemo.warn", () => {
        void vscode.window.showWarningMessage("Workspace has unsaved changes");
    });

    register("notificationDemo.error", () => {
        void vscode.window.showErrorMessage("Language server crashed");
    });

    // env.openExternal: где системного открывателя нет (ssh, headless), ссылка
    // приезжает человеку тостом с кнопкой «Copy Link».
    register("notificationDemo.openLink", async () => {
        const opened = await vscode.env.openExternal(vscode.Uri.parse("https://example.com/activate?token=demo"));
        show("openExternal " + String(opened));
    });

    // Буфер обмена — тот же, что у Copy/Paste редактора: после «Copy Link» в нём
    // лежит ссылка, и расширение её читает.
    register("notificationDemo.readClipboard", async () => {
        const text = await vscode.env.clipboard.readText();
        // Хост обрезает пункт полосы на 24 символах — берём голый хост ссылки.
        show(text === "" ? "clipboard empty" : "clip " + text.slice(8, 19));
    });

    // Вопрос задаётся сразу при активации — как это делают стоковые расширения.
    void ask();
};
