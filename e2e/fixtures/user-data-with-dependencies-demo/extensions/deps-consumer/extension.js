"use strict";

/** Тянется к API зависимости сразу в `activate()`, как форк bazel-java к `redhat.java`. */
exports.activate = function activate() {
    const vscode = require("vscode");
    const dep = vscode.extensions.getExtension("test.deps-provider");
    const status = dep !== undefined && dep.isActive ? dep.exports.status : "not ready";
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    item.text = `Dep: ${status}`;
    item.show();
};
exports.deactivate = function deactivate() {};
