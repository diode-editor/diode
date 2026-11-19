"use strict";

/**
 * Every shell integration event of the terminal API, one line each, in the "Shell Integration Probe" channel:
 * what an agent extension (Cline, Roo Code, Claude Code) sees of the terminal.
 */

const PREVIEW = 200;
const CONFIDENCE = ["Low", "Medium", "High"];

exports.activate = function activate(context) {
    const vscode = require("vscode");
    const channel = vscode.window.createOutputChannel("Shell Integration Probe");
    const log = (line) => channel.appendLine(line);
    const cwdOf = (uri) => (uri === undefined ? "-" : uri.fsPath);
    const commandLineOf = ({ value, confidence, isTrusted }) =>
        `${JSON.stringify(value)} (${CONFIDENCE[confidence] ?? confidence}, ${isTrusted ? "trusted" : "untrusted"})`;

    log("activated");
    // A terminal whose integration came alive before the activation: its change event went by.
    for (const terminal of vscode.window.terminals) {
        if (terminal.shellIntegration !== undefined) {
            log(`shellIntegration on activation: terminal ${JSON.stringify(terminal.name)}, cwd=${cwdOf(terminal.shellIntegration.cwd)}`);
        }
    }

    context.subscriptions.push(
        channel,
        vscode.window.onDidChangeTerminalShellIntegration(({ terminal, shellIntegration }) => {
            log(`shellIntegration changed: terminal ${JSON.stringify(terminal.name)}, cwd=${cwdOf(shellIntegration.cwd)}`);
        }),
        vscode.window.onDidStartTerminalShellExecution(async ({ terminal, execution }) => {
            log(`start: ${commandLineOf(execution.commandLine)} cwd=${cwdOf(execution.cwd)} terminal ${JSON.stringify(terminal.name)}`);
            for await (const data of execution.read()) {
                log(`data: ${JSON.stringify(data.slice(0, PREVIEW))}`);
            }
        }),
        vscode.window.onDidEndTerminalShellExecution(({ execution, exitCode }) => {
            log(`end: ${commandLineOf(execution.commandLine)} exit=${exitCode}`);
        }),
        vscode.commands.registerCommand("shellIntegrationProbe.executeCommand", async () => {
            const shellIntegration = vscode.window.activeTerminal?.shellIntegration;
            if (shellIntegration === undefined) {
                log("executeCommand: the active terminal has no shell integration");
                return;
            }
            const commandLine = await vscode.window.showInputBox({ prompt: "Command line to execute" });
            if (commandLine === undefined) return;
            const execution = shellIntegration.executeCommand(commandLine);
            log(`executeCommand: ${commandLineOf(execution.commandLine)}`);
        }),
    );
};

exports.deactivate = function deactivate() {};
