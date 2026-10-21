"use strict";

/** Форма вклада `editor/title` стокового Claude Code: accept/reject предложенного диффа под setContext-ключом. */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const result = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    result.text = "title:-";
    result.show();
    context.subscriptions.push(result);

    const viewing = (on) => vscode.commands.executeCommand("setContext", "editorTitleDemo.viewingProposedDiff", on);
    context.subscriptions.push(
        vscode.commands.registerCommand("editorTitleDemo.propose", () => {
            result.text = "title:proposed";
            return viewing(true);
        }),
        vscode.commands.registerCommand("editorTitleDemo.accept", () => {
            result.text = "title:accepted";
            return viewing(false);
        }),
        vscode.commands.registerCommand("editorTitleDemo.reject", () => {
            result.text = "title:rejected";
            return viewing(false);
        }),
        vscode.commands.registerCommand("editorTitleDemo.open", () => {
            result.text = "title:open";
        }),
    );
};

exports.deactivate = function deactivate() {};
