"use strict";

// Scenario language-status: two items for plain text. Choosing "Demo Server" in the
// Language Status quick pick runs `restart`, which edits the item's detail.
exports.activate = function activate(context) {
    const vscode = require("vscode");

    const server = vscode.languages.createLanguageStatusItem("server", { language: "plaintext" });
    server.name = "Demo Server";
    server.text = "$(check) Demo Server";
    server.detail = "ready";
    server.command = { command: "languageStatusDemo.restart", title: "Restart", arguments: ["menu"] };

    const lint = vscode.languages.createLanguageStatusItem("lint", { language: "plaintext" });
    lint.text = "Demo Lint";
    lint.detail = "no config";

    let restarts = 0;
    context.subscriptions.push(
        vscode.commands.registerCommand("languageStatusDemo.restart", function (from) {
            restarts += 1;
            server.detail = "restarted " + restarts + " from " + from;
        }),
        vscode.commands.registerCommand("languageStatusDemo.error", function () {
            lint.severity = vscode.LanguageStatusSeverity.Error;
            lint.detail = "config is broken";
        }),
        vscode.commands.registerCommand("languageStatusDemo.busy", function () {
            server.busy = !server.busy;
        }),
        server,
        lint,
    );
};
