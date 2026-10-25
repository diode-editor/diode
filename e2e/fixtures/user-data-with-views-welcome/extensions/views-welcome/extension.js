"use strict";

/**
 * The Bookmarks section in Explorer starts with an empty root, so it shows the manifest's `viewsWelcome`.
 * Its button runs `welcomeDemo.add` with the JSON argument from the link; the tree gets a row and replaces
 * the welcome.
 */
const vscode = require("vscode");

exports.activate = function activate(context) {
    const bookmarks = [];
    const changed = new vscode.EventEmitter();

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("welcomeDemo.bookmarks", {
            onDidChangeTreeData: changed.event,
            getTreeItem: function (label) {
                const item = new vscode.TreeItem(label);
                item.iconPath = new vscode.ThemeIcon("bookmark");
                return item;
            },
            getChildren: function (element) {
                return element === undefined ? bookmarks : [];
            },
        }),
        vscode.commands.registerCommand("welcomeDemo.add", function (name) {
            bookmarks.push("Bookmark: " + name);
            changed.fire();
        }),
    );
};

exports.deactivate = function deactivate() {};
