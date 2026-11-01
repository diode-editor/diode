"use strict";

/**
 * Fixture for extensionHost.treeViewFrame.test.ts, built like Maven for Java's Plugins: a row without an `id` starts
 * under one label, and once the extension learns more it fires the same element with another label. The handle of a
 * row without an `id` comes from its label, so the refreshed row has a new handle.
 */
const vscode = require("vscode");

exports.activate = function activate(context) {
    const plugin = { label: "org.apache:long-plugin:1.0", children: [{ label: "goal-one" }] };
    const changed = new vscode.EventEmitter();
    const view = vscode.window.createTreeView("test.relabel", {
        treeDataProvider: {
            onDidChangeTreeData: changed.event,
            getTreeItem: function (element) {
                return new vscode.TreeItem(
                    element.label,
                    element.children
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None,
                );
            },
            getChildren: function (element) {
                return element === undefined ? [plugin] : element.children;
            },
        },
    });
    context.subscriptions.push(
        view,
        vscode.commands.registerCommand("test.relabel.fire", function () {
            plugin.label = "short";
            changed.fire(plugin);
        }),
    );
};
