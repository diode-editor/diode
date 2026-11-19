import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { createTerminalShellIntegrations, type IShellIntegrationTerminal } from "./terminalShellIntegration.ts";

export const HIGH = { confidence: 2, isTrusted: true };
export const LOW = { confidence: 0, isTrusted: false };

/** The host side of the wire, synchronous: a handler that throws fails the test. */
export function setupShellIntegrations() {
    const handlers = new Map<string, (params: unknown) => void>();
    const requested: unknown[] = [];
    const rpc = {
        handleNotification: (method: string, handler: (params: unknown) => void) => {
            handlers.set(method, handler);
            return { dispose: () => undefined };
        },
        notify: (method: string, params: unknown) => requested.push({ method, params }),
    } as unknown as SubprocessRpc;
    const terminals = new Map<number, IShellIntegrationTerminal>();
    for (const id of [1, 2])
        terminals.set(id, { value: { name: `t${String(id)}` } as vscode.Terminal, shellIntegration: undefined });
    const integrations = createTerminalShellIntegrations(rpc, (id) => terminals.get(id));
    const send = (method: string, params: unknown): void => {
        handlers.get(method)?.(params);
    };
    const log: string[] = [];
    const starts: vscode.TerminalShellExecution[] = [];
    const ends: [vscode.TerminalShellExecution, string, number | undefined][] = [];
    integrations.onDidChangeTerminalShellIntegration(({ terminal, shellIntegration }) => {
        log.push(`changed ${terminal.name} cwd=${shellIntegration.cwd?.fsPath ?? "-"}`);
    });
    integrations.onDidStartTerminalShellExecution(({ terminal, execution }) => {
        starts.push(execution);
        log.push(`start ${terminal.name} ${execution.commandLine.value}`);
    });
    integrations.onDidEndTerminalShellExecution(({ terminal, execution, exitCode }) => {
        ends.push([execution, execution.commandLine.value, exitCode]);
        log.push(`end ${terminal.name} ${execution.commandLine.value} exit=${String(exitCode)}`);
    });
    const integration = (id: number): vscode.TerminalShellIntegration => {
        const value = terminals.get(id)?.shellIntegration;
        if (value === undefined) throw new Error(`no integration on ${String(id)}`);
        return value;
    };
    const start = (id: number, value: string, line = HIGH): void => {
        send("terminal.shellExecution.start", { id, supportsExecuteCommand: true, commandLine: { value, ...line } });
    };
    const end = (id: number, value: string, exitCode?: number): void => {
        send("terminal.shellExecution.end", { id, commandLine: { value, ...HIGH }, exitCode });
    };
    const data = (id: number, value: string): void => {
        send("terminal.shellExecution.data", { id, data: value });
    };
    return { integrations, send, log, starts, ends, requested, integration, start, end, data };
}
