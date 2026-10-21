"use strict";

/**
 * Fixture for extensionHost.claudeCodeSurface.test.ts: mirrors how the stock
 * `Anthropic.claude-code` touches API that did not exist before.
 *
 * Module top level, as in the extension bundle: `NotebookCellOutputItem.error(...).mime`
 * is evaluated at load time; without the class the entry point did not load at all.
 */
const vscode = require("vscode");

const ERROR_MIME = vscode.NotebookCellOutputItem.error(new Error("probe")).mime;

exports.activate = function activate(context) {
    // The extension reads `env.shell`/`env.machineId` already in activate().
    const atActivate = { machineId: vscode.env.machineId, shell: vscode.env.shell, errorMime: ERROR_MIME };

    // Waits for shell integration and falls back; the subscription must succeed.
    const shellIntegrationSub = vscode.window.onDidChangeTerminalShellIntegration(function () {});
    context.subscriptions.push(shellIntegrationSub);

    let message;
    let controller;
    let thread;
    context.subscriptions.push(
        vscode.commands.registerCommand("test.claude.atActivate", function () {
            return atActivate;
        }),
        vscode.commands.registerCommand("test.claude.setStatusBarMessage", function (text, timeout) {
            message = vscode.window.setStatusBarMessage(text, timeout);
        }),
        vscode.commands.registerCommand("test.claude.clearStatusBarMessage", function () {
            message.dispose();
        }),
        // Exactly like the extension's per-hunk diff review: a thread on the hunk's line.
        vscode.commands.registerCommand("test.claude.commentThread", function (uri) {
            controller = controller || vscode.comments.createCommentController("claude-code-hunks", "Claude Code proposed changes");
            thread = controller.createCommentThread(vscode.Uri.parse(uri), new vscode.Range(3, 0, 3, 0), []);
            thread.canReply = false;
            thread.label = " ";
            thread.contextValue = "hunk";
            thread.state = vscode.CommentThreadState.Resolved;
            thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
            return {
                uri: thread.uri.toString(),
                line: thread.range.start.line,
                canReply: thread.canReply,
                state: thread.state,
                collapsibleState: thread.collapsibleState,
            };
        }),
        vscode.commands.registerCommand("test.claude.terminalShellIntegration", function () {
            const terminal = vscode.window.createTerminal({ name: "claude-probe", hideFromUser: true });
            const result = { shellIntegration: terminal.shellIntegration === undefined ? "undefined" : "defined" };
            terminal.dispose();
            return result;
        }),
    );
};
