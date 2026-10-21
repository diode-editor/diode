"use strict";

/**
 * Как форк bazel-java: класс узла `extends vscode.TreeItem` на уровне модуля, `activate()` СНАЧАЛА
 * регистрирует дерево. Дерево в TUI пока не рисуется, но модуль обязан загрузиться, а команда
 * `Tree Outline: List Targets` — доехать до палитры и исполниться.
 */
const vscode = require("vscode");

class RunTarget extends vscode.TreeItem {
    constructor(label) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon("play");
        this.contextValue = "runTarget";
    }
}

exports.activate = function activate(context) {
    const targets = [new RunTarget("//app:main"), new RunTarget("//lib:greeter")];

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("treeOutline.targets", {
            getTreeItem: function (element) {
                return element;
            },
            getChildren: function () {
                return targets;
            },
        }),
    );

    const channel = vscode.window.createOutputChannel("Tree Outline");
    context.subscriptions.push(channel);

    context.subscriptions.push(
        vscode.commands.registerCommand("treeOutline.listTargets", function () {
            channel.appendLine(
                "targets: " +
                    targets
                        .map(function (t) {
                            return t.label;
                        })
                        .join(", ") +
                    " — расширение живо, хотя дерева нет",
            );
            channel.show();
        }),
    );
};

exports.deactivate = function deactivate() {};
