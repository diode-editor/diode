"use strict";

/**
 * Фикстура для extensionHost.treeViewNoop.test.ts — типовое расширение с деревом
 * целей сборки (форма bazel-java: `class BazelRunTarget extends vscode.TreeItem`).
 *
 * Класс узла объявлен на УРОВНЕ МОДУЛЯ: без значения `vscode.TreeItem` модуль
 * падает ещё при загрузке («Class extends value undefined»), до `activate()`.
 * В `activate()` дерево регистрируется ПЕРВЫМ, и только потом — команда
 * `test.treeTargets`: её исполнение и есть наблюдаемое «расширение живо».
 */
const vscode = require("vscode");

class Target extends vscode.TreeItem {
    constructor(label) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon("play");
        this.contextValue = "target";
    }
}

exports.activate = function activate(context) {
    const targets = [new Target("//app:main"), new Target("//lib:greeter")];
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("test.targets", {
            getTreeItem: function (element) {
                return element;
            },
            getChildren: function () {
                return targets;
            },
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("test.treeTargets", function () {
            return targets.map(function (t) {
                return t.label + ":" + t.collapsibleState + ":" + t.iconPath.id;
            });
        }),
    );
};
