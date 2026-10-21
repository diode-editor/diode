"use strict";

/** The dependency is unsatisfied: `activate()` must not be called — a call would show in the status bar. */
exports.activate = function activate() {
    const vscode = require("vscode");
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    item.text = "Broken: activated (must not happen)";
    item.show();
};
exports.deactivate = function deactivate() {};
