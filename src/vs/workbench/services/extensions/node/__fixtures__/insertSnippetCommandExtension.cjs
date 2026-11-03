"use strict";

/** Fixture for extensionHost.insertSnippet.edges.test.ts: `editor.action.insertSnippet` called by an extension. */
const vscode = require("vscode");

exports.activate = function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand("test.snippetCommand.run", (args) =>
            vscode.commands.executeCommand("editor.action.insertSnippet", args),
        ),
    );
};
