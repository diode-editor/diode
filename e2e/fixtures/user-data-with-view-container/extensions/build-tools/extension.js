"use strict";

/**
 * Activates only by `onView:buildTools.targets` (declared) or the implicit `onView:` of its other view: the
 * container switcher opening "Build Tools" is what starts it. The tree is registered like a real extension
 * would, although the TUI does not draw extension trees yet.
 */
const vscode = require("vscode");

exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider("buildTools.targets", {
            getTreeItem: function (element) {
                return element;
            },
            getChildren: function () {
                return [new vscode.TreeItem("//app:main"), new vscode.TreeItem("//lib:greeter")];
            },
        }),
    );
};

exports.deactivate = function deactivate() {};
