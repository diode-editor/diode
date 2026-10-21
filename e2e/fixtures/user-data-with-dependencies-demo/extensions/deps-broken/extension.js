"use strict";

/** Зависимость не удовлетворена: `activate()` не должен быть вызван — вызов покажет статус-бар. */
exports.activate = function activate() {
    const vscode = require("vscode");
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    item.text = "Broken: activated (must not happen)";
    item.show();
};
exports.deactivate = function deactivate() {};
