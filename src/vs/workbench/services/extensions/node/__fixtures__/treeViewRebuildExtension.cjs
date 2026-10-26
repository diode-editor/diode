"use strict";

/**
 * Fixture for extensionHost.treeViewFrame.test.ts, built like Todo Tree: Expand/Collapse rebuild every element with
 * a NUMERIC `id` (`1e6 * build + n`, so the very first one is `0`) in the asked state and fire
 * `onDidChangeTreeData()`. `notes` keeps its string id; `test.rebuild.flipNotes` makes it Expanded and fires it.
 */
const vscode = require("vscode");

exports.activate = function activate(context) {
    let build = 0;
    let counter = 0;
    let expanded = false;
    let roots = [];
    const notes = { id: "notes", label: "notes", state: vscode.TreeItemCollapsibleState.Collapsed, children: [] };
    notes.children.push({ id: "notes/n1", label: "n1" });

    function folder(label, children) {
        return { id: 1e6 * build + counter++, label, children };
    }

    function rebuild() {
        roots = [
            folder("workspace", [folder("src", [folder("a.ts", undefined)]), folder("lib", [folder("c.py", undefined)])]),
            notes,
        ];
    }

    rebuild();
    const changed = new vscode.EventEmitter();
    const view = vscode.window.createTreeView("test.rebuild", {
        treeDataProvider: {
            onDidChangeTreeData: changed.event,
            getTreeItem: function (element) {
                const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
                item.id = element.id;
                if (element === notes) item.collapsibleState = notes.state;
                else if (element.children !== undefined) {
                    item.collapsibleState = expanded
                        ? vscode.TreeItemCollapsibleState.Expanded
                        : vscode.TreeItemCollapsibleState.Collapsed;
                }
                return item;
            },
            getChildren: function (element) {
                return element === undefined ? roots : element.children;
            },
        },
    });
    function setExpanded(value) {
        expanded = value;
        build++;
        rebuild();
        changed.fire();
    }
    context.subscriptions.push(
        view,
        vscode.commands.registerCommand("test.rebuild.expand", function () {
            setExpanded(true);
        }),
        vscode.commands.registerCommand("test.rebuild.collapse", function () {
            setExpanded(false);
        }),
        vscode.commands.registerCommand("test.rebuild.flipNotes", function () {
            notes.state = vscode.TreeItemCollapsibleState.Expanded;
            changed.fire(notes);
        }),
    );
};
