import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { createTerminalShellIntegrations, type IShellIntegrationTerminal } from "./terminalShellIntegration.ts";

// A multi-line `executeCommand`: each line is a command of its own to the shell, one execution to the extension.

const HIGH = { confidence: 2, isTrusted: true };
const LOW = { confidence: 0, isTrusted: false };

function setup() {
    const handlers = new Map<string, (params: unknown) => void>();
    const rpc = {
        handleNotification: (method: string, handler: (params: unknown) => void) => {
            handlers.set(method, handler);
            return { dispose: () => undefined };
        },
        notify: () => undefined,
    } as unknown as SubprocessRpc;
    const terminal: IShellIntegrationTerminal = {
        value: { name: "t" } as vscode.Terminal,
        shellIntegration: undefined,
    };
    const integrations = createTerminalShellIntegrations(rpc, () => terminal);
    const send = (method: string, params: unknown): void => {
        handlers.get(method)?.(params);
    };
    send("terminal.shellIntegration.changed", { id: 1, supportsExecuteCommand: true });
    const starts: vscode.TerminalShellExecution[] = [];
    const ends: [vscode.TerminalShellExecution, string, number | undefined][] = [];
    integrations.onDidStartTerminalShellExecution(({ execution }) => starts.push(execution));
    integrations.onDidEndTerminalShellExecution(({ execution, exitCode }) =>
        ends.push([execution, execution.commandLine.value, exitCode]),
    );
    const executeCommand = (commandLine: string): vscode.TerminalShellExecution => {
        if (terminal.shellIntegration === undefined) throw new Error("no integration");
        return terminal.shellIntegration.executeCommand(commandLine);
    };
    const start = (value: string, line = HIGH): void => {
        send("terminal.shellExecution.start", { id: 1, supportsExecuteCommand: true, commandLine: { value, ...line } });
    };
    const end = (value: string, exitCode: number): void => {
        send("terminal.shellExecution.end", { id: 1, commandLine: { value, ...HIGH }, exitCode });
    };
    const data = (value: string): void => {
        send("terminal.shellExecution.data", { id: 1, data: value });
    };
    return {
        starts,
        ends,
        executeCommand,
        start,
        end,
        data,
        close: () => {
            integrations.close(1);
        },
    };
}

async function macrotask(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function readAll(stream: AsyncIterable<string>): Promise<string> {
    let out = "";
    for await (const chunk of stream) out += chunk;
    return out;
}

describe("ext host shell integration — a multi-line executeCommand", () => {
    it("its lines are one execution: one start, the end after the last line with its code and the requested line", async () => {
        const h = setup();
        const execution = h.executeCommand("  echo a\n\n echo b \n");
        const output = readAll(execution.read());
        h.start("echo a");
        h.data("a");
        h.end("echo a", 0);
        h.start("echo b");
        h.data("b");
        await macrotask();
        expect(h.starts).toStrictEqual([execution]);
        expect(h.ends).toStrictEqual([]);
        h.end("echo b", 3);
        await macrotask();
        expect(h.ends).toStrictEqual([[execution, "  echo a\n\n echo b \n", 3]]);
        expect(await output).toBe("ab");
    });

    it("lines the shell runs as one command resolve together", async () => {
        const h = setup();
        const execution = h.executeCommand("a\nb\nc");
        h.start("a\nb");
        h.end("a\nb", 0);
        h.start("c");
        h.end("c", 0);
        await macrotask();
        expect(h.starts).toStrictEqual([execution]);
        expect(h.ends).toStrictEqual([[execution, "a\nb\nc", 0]]);
    });

    it("a command that is not its next line ends it without a code and starts on its own", async () => {
        const h = setup();
        const execution = h.executeCommand("a\nb");
        h.start("a");
        h.end("a", 0);
        h.start("other");
        h.end("other", 1);
        await macrotask();
        expect(h.starts.map((e) => e.commandLine.value)).toStrictEqual(["a\nb", "other"]);
        expect(h.starts[0]).toBe(execution);
        expect(h.ends.map(([, line, code]) => [line, code])).toStrictEqual([
            ["a\nb", undefined],
            ["other", 1],
        ]);
    });

    it("cut short by the terminal closing: it ends without a code", () => {
        const h = setup();
        h.executeCommand("a\nb");
        h.start("a");
        h.close();
        expect(h.ends.map(([, line, code]) => [line, code])).toStrictEqual([["a\nb", undefined]]);
    });

    it("an execution after a finished multi-line one takes the line the shell reports at its end", async () => {
        const h = setup();
        h.executeCommand("a\nb");
        h.start("a");
        h.end("a", 0);
        h.start("b");
        h.end("b", 0);
        h.start("l", LOW);
        h.end("ls", 0);
        await macrotask();
        expect(h.ends.map(([, line]) => line)).toStrictEqual(["a\nb", "ls"]);
    });

    it("a low-confidence start takes the oldest request: a single-line one, no lines held back", async () => {
        const h = setup();
        const execution = h.executeCommand("a\nb");
        h.start("whatever", LOW);
        h.end("whatever", 0);
        await macrotask();
        expect(h.starts).toStrictEqual([execution]);
        expect(h.ends.map(([, line]) => line)).toStrictEqual(["whatever"]);
    });

    it("a line that matches no request's first lines, or an empty one, starts an execution of its own", async () => {
        const h = setup();
        const execution = h.executeCommand("a\nb");
        h.start("b");
        h.end("b", 0);
        h.start("");
        h.end("", 0);
        h.start("a");
        await macrotask();
        expect(h.starts.map((e) => e.commandLine.value)).toStrictEqual(["b", "", "a\nb"]);
        expect(h.starts[2]).toBe(execution);
        expect(h.ends.map(([, line]) => line)).toStrictEqual(["b", ""]);
    });

    it("while its last lines run, an empty command line is no part of it", async () => {
        const h = setup();
        h.executeCommand("a\nb");
        h.start("a");
        h.start("");
        expect(h.starts.map((e) => e.commandLine.value)).toStrictEqual(["a\nb", ""]);
        expect(h.ends.map(([, line, code]) => [line, code])).toStrictEqual([["a\nb", undefined]]);
    });
});
