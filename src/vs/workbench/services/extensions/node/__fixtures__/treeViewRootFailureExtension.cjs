"use strict";

/**
 * Fixture for extensionHost.treeViewFrame.test.ts: an expanded package with targets, and a switch that makes only the
 * ROOT `getChildren` reject. `test.rootFail.fire` fires `onDidChangeTreeData()` without changing the data.
 */
const vscode = require("vscode");

exports.activate = function activate(context) {
    const app = { label: "//app", children: [{ label: "app-main" }, { label: "app-test" }] };
    const roots = [app, { label: "//lib" }];
    const requested = [];
    let failRoot = false;
    const changed = new vscode.EventEmitter();
    const view = vscode.window.createTreeView("test.rootFail", {
        treeDataProvider: {
            onDidChangeTreeData: changed.event,
            getTreeItem: function (element) {
                return new vscode.TreeItem(
                    element.label,
                    element.children === undefined
                        ? vscode.TreeItemCollapsibleState.None
                        : vscode.TreeItemCollapsibleState.Expanded,
                );
            },
            getChildren: function (element) {
                requested.push(element === undefined ? "<root>" : element.label);
                if (element === undefined && failRoot) return Promise.reject(new Error("root rejected"));
                return element === undefined ? roots : element.children;
            },
        },
    });
    context.subscriptions.push(
        view,
        vscode.commands.registerCommand("test.rootFail.set", function (value) {
            failRoot = value;
        }),
        vscode.commands.registerCommand("test.rootFail.fire", function () {
            changed.fire();
        }),
        vscode.commands.registerCommand("test.rootFail.requested", function () {
            return requested;
        }),
    );
};
