"use strict";

/**
 * Fixture for extensionHost.languageStatus.test.ts and the language-status e2e scenario: on activation the
 * extension creates a language status item for plain text and edits it through commands it registers itself.
 * The whole round trip: `createLanguageStatusItem` → workbench → pick → extension command → field edit → back.
 */
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const item = vscode.languages.createLanguageStatusItem("demo", { language: "plaintext" });
    item.name = "Language Status Demo";
    item.text = "$(check) Demo Server";
    item.detail = "ready";
    item.command = { command: "test.languageStatus.restart", title: "Restart", arguments: ["now"] };

    let restarts = 0;
    context.subscriptions.push(
        vscode.commands.registerCommand("test.languageStatus.restart", function (when) {
            restarts += 1;
            item.detail = "restarted " + restarts + " (" + when + ")";
            return restarts;
        }),
        vscode.commands.registerCommand("test.languageStatus.warn", function () {
            item.severity = vscode.LanguageStatusSeverity.Warning;
        }),
        vscode.commands.registerCommand("test.languageStatus.busy", function (busy) {
            item.busy = busy;
        }),
        vscode.commands.registerCommand("test.languageStatus.dispose", function () {
            item.dispose();
        }),
        // Kills its own process to model an extension crash. The exit is deferred
        // by a tick so the RPC reply reaches the caller.
        vscode.commands.registerCommand("test.languageStatus.kill", function () {
            setTimeout(function () {
                process.exit(1);
            }, 10);
            return "dying";
        }),
        item,
    );
};
