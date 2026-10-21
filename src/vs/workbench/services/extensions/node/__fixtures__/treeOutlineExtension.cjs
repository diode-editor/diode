"use strict";

/**
 * Fixture for extensionHost.treeViewNoop.test.ts: a typical extension with a tree
 * of build targets (bazel-java shape: `class BazelRunTarget extends vscode.TreeItem`).
 *
 * The node class is declared at MODULE TOP LEVEL: without a `vscode.TreeItem` value the module
 * fails already at load time ("Class extends value undefined"), before `activate()`.
 * `activate()` registers the tree FIRST, and only then the
 * `test.treeTargets` command: executing it is the observable "extension is alive".
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
