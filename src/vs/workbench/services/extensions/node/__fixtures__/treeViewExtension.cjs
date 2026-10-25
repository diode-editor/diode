"use strict";

/**
 * Fixture for extensionHost.treeView.test.ts: a build-targets tree shaped like the bazel-java fork
 * (`class Target extends vscode.TreeItem` at MODULE TOP LEVEL — without a `vscode.TreeItem` value the
 * module fails at load time). `activate()` registers the tree first; the `test.tree.*` commands drive
 * it and report what the extension saw.
 */
const vscode = require("vscode");

class Target extends vscode.TreeItem {
    constructor(label, children) {
        super(
            label,
            children === undefined ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed,
        );
        this.children = children;
        this.iconPath = new vscode.ThemeIcon("play");
        this.contextValue = "target";
    }
}

exports.activate = function activate(context) {
    let roots = [new Target("//app", [new Target("//app:main"), new Target("//app:test")]), new Target("//lib")];
    roots[1].id = "lib";
    roots[1].description = "library";
    roots[0].children[0].command = { command: "test.tree.run", title: "Run", arguments: [roots[0].children[0]] };
    const runs = [];
    const events = [];
    let failChildren = false;
    const changed = new vscode.EventEmitter();
    const provider = {
        onDidChangeTreeData: changed.event,
        getTreeItem: function (element) {
            return element;
        },
        getChildren: function (element) {
            if (failChildren) throw new Error("getChildren exploded");
            return element === undefined ? roots : element.children;
        },
    };
    const view = vscode.window.createTreeView("test.targets", { treeDataProvider: provider, showCollapseAll: true });
    view.onDidChangeVisibility(function (e) {
        events.push("visible:" + e.visible);
    });
    view.onDidExpandElement(function (e) {
        events.push("expand:" + e.element.label);
    });
    view.onDidCollapseElement(function (e) {
        events.push("collapse:" + e.element.label);
    });
    view.onDidChangeSelection(function (e) {
        events.push(
            "selection:" +
                e.selection
                    .map(function (t) {
                        return t.label;
                    })
                    .join(","),
        );
    });
    context.subscriptions.push(view);

    context.subscriptions.push(
        vscode.commands.registerCommand("test.tree.run", function (target) {
            // The argument is the extension's own object, not a copy that crossed the wire.
            runs.push(target.label + (target instanceof Target ? ":same" : ":copy"));
        }),
        vscode.commands.registerCommand("test.tree.state", function () {
            return { runs: runs, events: events, visible: view.visible };
        }),
        vscode.commands.registerCommand("test.tree.fireRoot", function () {
            roots = [roots[1], new Target("//tools")];
            changed.fire();
        }),
        vscode.commands.registerCommand("test.tree.fireLib", function () {
            roots[roots.length > 1 && roots[0].id === "lib" ? 0 : 1].description = "renamed";
            changed.fire(
                roots.find(function (t) {
                    return t.id === "lib";
                }),
            );
        }),
        vscode.commands.registerCommand("test.tree.burst", function () {
            for (let i = 0; i < 5; i++) changed.fire();
        }),
        vscode.commands.registerCommand("test.tree.fail", function (value) {
            failChildren = value;
        }),
        vscode.commands.registerCommand("test.tree.setTitle", function () {
            view.title = "Targets";
            view.description = "3 found";
            view.message = "Pick a target";
        }),
        vscode.commands.registerCommand("test.tree.revealWithoutParent", function () {
            return view.reveal(roots[0]).then(
                function () {
                    return "resolved";
                },
                function (err) {
                    return err.message;
                },
            );
        }),
        vscode.commands.registerCommand("test.tree.reregister", function () {
            const second = vscode.window.registerTreeDataProvider("test.targets", {
                getTreeItem: function (element) {
                    return element;
                },
                getChildren: function () {
                    return [new vscode.TreeItem("second provider")];
                },
            });
            context.subscriptions.push(second);
        }),
        vscode.commands.registerCommand("test.tree.disposeFirst", function () {
            view.dispose();
        }),
    );
};
