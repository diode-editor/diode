"use strict";

/**
 * Фикстура для extensionHost.orphans.test.ts. Имитирует расширение с языковым
 * сервером: в `activate` поднимает долгоживущий ВНУК-процесс (как redhat.java
 * поднимает jdtls) и отдаёт его pid командой `test.orphans.serverPid`.
 *
 * Внука расширение намеренно НЕ закрывает в `deactivate` — именно так ведёт
 * себя расширение, упавшее или не успевшее попрощаться. Сигнал прямому
 * субпроцессу такого внука не касается, поэтому его должен снять групповой
 * сигнал (`process.kill(-pid)`), иначе он остаётся сиротой и продолжает
 * писать в каталоги расширения.
 */
const cp = require("node:child_process");

/** Внук просто живёт: держит таймер и ничего не делает. */
const SERVER_SOURCE = "setInterval(function () {}, 1000);";

exports.activate = function activate(context) {
    const vscode = require("vscode");
    const server = cp.spawn(process.execPath, ["-e", SERVER_SOURCE], { stdio: "ignore" });
    context.subscriptions.push(
        vscode.commands.registerCommand("test.orphans.serverPid", function () {
            return server.pid;
        }),
    );
};
