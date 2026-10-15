"use strict";

/**
 * Фикстура для extensionHost.claudeCodeSurface.test.ts: повторяет, как стоковое
 * `Anthropic.claude-code` трогает API, которого раньше не было.
 *
 * Верхний уровень модуля — как в бандле расширения: `NotebookCellOutputItem.error(...).mime`
 * считается при загрузке; без класса точка входа не грузилась вовсе.
 */
const vscode = require("vscode");

const ERROR_MIME = vscode.NotebookCellOutputItem.error(new Error("probe")).mime;

exports.activate = function activate(context) {
    // `env.shell`/`env.machineId` расширение читает уже в activate().
    const atActivate = { machineId: vscode.env.machineId, shell: vscode.env.shell, errorMime: ERROR_MIME };

    // Ждёт shell integration и уходит в фоллбэк — подписка обязана проходить.
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
        // Ровно как поханковая ревизия диффа у расширения: тред на строке ханка.
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
