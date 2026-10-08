"use strict";

/**
 * Расширение с неудовлетворённой зависимостью: `activate()` не должен быть
 * вызван вовсе. Если вызван — статус-бар это покажет.
 */
exports.activate = function activate() {
    const vscode = require("vscode");
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    item.text = "Broken: activated (must not happen)";
    item.show();
};
exports.deactivate = function deactivate() {};
