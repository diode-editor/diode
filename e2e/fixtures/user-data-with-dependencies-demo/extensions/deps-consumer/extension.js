"use strict";

/**
 * Зависимое расширение демо extensionDependencies. В `activate()` сразу
 * тянется к API зависимости (как форк bazel-java к `redhat.java`) и пишет
 * увиденное в статус-бар: «Dep: Started» — зависимость поднялась раньше,
 * «Dep: not ready» — нет.
 */
exports.activate = function activate() {
    const vscode = require("vscode");
    const dep = vscode.extensions.getExtension("test.deps-provider");
    const status = dep !== undefined && dep.isActive ? dep.exports.status : "not ready";
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    item.text = `Dep: ${status}`;
    item.show();
};
exports.deactivate = function deactivate() {};
