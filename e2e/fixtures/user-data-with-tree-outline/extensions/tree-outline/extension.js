"use strict";

/**
 * Like the bazel-java fork: the node class `extends vscode.TreeItem` at module top level, `activate()` registers
 * the tree FIRST. The Run Targets section in Explorer shows packages with their targets; a target's command
 * shows a toast, and `Tree Outline: Add Target` changes the data and fires `onDidChangeTreeData`. The
 * `view/item/context` commands (a row's menu, the inline Edit on targets) write the row they got to the
 * "Tree Outline" output: `same` means the very `Node` the provider returned.
 */
const vscode = require("vscode");

class Node extends vscode.TreeItem {
    constructor(label, children) {
        super(
            label,
            children === undefined ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Expanded,
        );
        this.children = children;
        if (children === undefined) {
            this.iconPath = new vscode.ThemeIcon("play");
            this.contextValue = "runTarget";
            this.command = { command: "treeOutline.run", title: "Run", arguments: [this] };
        } else {
            this.iconPath = new vscode.ThemeIcon("package");
            this.contextValue = "package";
            this.description = children.length + " targets";
        }
    }
}

exports.activate = function activate(context) {
    const app = new Node("//app", [new Node("main"), new Node("server")]);
    const lib = new Node("//lib", [new Node("greeter")]);
    lib.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    const roots = [app, lib];
    const changed = new vscode.EventEmitter();

    const view = vscode.window.createTreeView("treeOutline.targets", {
        treeDataProvider: {
            onDidChangeTreeData: changed.event,
            getTreeItem: function (element) {
                return element;
            },
            getChildren: function (element) {
                return element === undefined ? roots : element.children;
            },
        },
        showCollapseAll: true,
    });
    context.subscriptions.push(view);

    const output = vscode.window.createOutputChannel("Tree Outline");
    const report = function (action) {
        return function (node, selection) {
            const name = function (n) {
                return n.label + (n instanceof Node ? " (same)" : " (copy)");
            };
            const others = selection === undefined ? "" : " with " + selection.map(name).join(", ");
            output.appendLine(action + ": " + name(node) + others);
            output.show(true);
        };
    };

    context.subscriptions.push(
        output,
        vscode.commands.registerCommand("treeOutline.inspect", report("inspect")),
        vscode.commands.registerCommand("treeOutline.build", report("build")),
        vscode.commands.registerCommand("treeOutline.copyName", report("copy")),
        vscode.commands.registerCommand("treeOutline.edit", report("edit")),
        vscode.commands.registerCommand("treeOutline.run", function (target) {
            vscode.window.showInformationMessage("Running " + target.label);
        }),
        vscode.commands.registerCommand("treeOutline.addTarget", function () {
            roots.push(new Node("//tools", [new Node("lint")]));
            changed.fire();
        }),
    );
};

exports.deactivate = function deactivate() {};
