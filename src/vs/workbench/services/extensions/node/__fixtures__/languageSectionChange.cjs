"use strict";

/**
 * Fixture for extensionHost.languageSectionChange.test.ts. Writes the user's `[plaintext]`
 * section and reports what its `onDidChangeConfiguration` listener saw: an extension that reads
 * `getConfiguration().get('[plaintext]')` re-reads it when the event affects `[plaintext]`.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");
    const seen = [];
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            seen.push({
                section: event.affectsConfiguration("[plaintext]"),
                setting: event.affectsConfiguration("editor.tabSize"),
                forLanguage: event.affectsConfiguration("editor.tabSize", { languageId: "plaintext" }),
            });
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand("test.langSection.write", async (value) => {
            await vscode.workspace.getConfiguration().update("[plaintext]", value, vscode.ConfigurationTarget.Global);
            return { section: vscode.workspace.getConfiguration().get("[plaintext]"), seen: seen.splice(0) };
        }),
    );
};
