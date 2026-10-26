"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** Todo Tree's `ripgrepPath()`: `path.join(appRoot, …)` and `existsSync` right in activate(). */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const rg = process.platform === "win32" ? "rg.exe" : "rg";
    const found = fs.existsSync(path.join(vscode.env.appRoot, "node_modules", "@vscode", "ripgrep", "bin", rg));
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
    item.text = found ? "appRoot ok" : "appRoot missing";
    item.show();
    context.subscriptions.push(item);
    vscode.commands.registerCommand("test.appRoot.probe", () => ({ appRoot: vscode.env.appRoot, found }));
};

exports.deactivate = function deactivate() {};
