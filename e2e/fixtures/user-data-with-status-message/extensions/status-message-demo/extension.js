"use strict";

/** Второе сообщение на 3 с поверх первого, уехав, возвращает первое — стек, как у эталона. */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    context.subscriptions.push(
        vscode.window.setStatusBarMessage("Demo: watching"),
        vscode.commands.registerCommand("statusMessageDemo.timed", function () {
            vscode.window.setStatusBarMessage("Demo: no change", 3000);
        }),
        vscode.commands.registerCommand("statusMessageDemo.env", function () {
            const shell = vscode.env.shell.split("/").pop();
            const id = /^[0-9a-f]{64}$/.test(vscode.env.machineId) ? "sha256" : "uuid";
            vscode.window.showInformationMessage("env.shell: " + shell + " · env.machineId: " + id);
        }),
    );
};
