"use strict";

// Повторяет `go.locate.tools` у golang.go: отчёт собирается строкой, уходит в
// безымянный markdown-документ и показывается вкладкой.
exports.activate = function activate(context) {
    const vscode = require("vscode");
    context.subscriptions.push(
        vscode.commands.registerCommand("untitledReportDemo.locateTools", async function () {
            const content = [
                "# Tools Configuration",
                "",
                "## Environment",
                "",
                "GOBIN: undefined",
                "",
                "## Tools",
                "",
                "\tgo:\t/usr/local/go/bin/go",
                "\tgopls:\t/home/user/go/bin/gopls\t(v0.24.0)",
                "",
            ].join("\n");
            const doc = await vscode.workspace.openTextDocument({ content, language: "markdown" });
            await vscode.window.showTextDocument(doc);
        }),
    );
};
