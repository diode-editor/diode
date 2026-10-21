"use strict";

/**
 * Like the bazel-java fork: the node class `extends vscode.TreeItem` at module top level, `activate()` registers
 * the tree FIRST. The TUI doesn't draw trees yet, but the module must load, and the
 * `Tree Outline: List Targets` command must reach the command palette and execute.
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
