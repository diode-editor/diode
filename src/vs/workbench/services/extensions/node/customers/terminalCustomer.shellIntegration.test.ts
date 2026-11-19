import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { FakeEditorTerminals } from "../../../../../../TestUtils/FakeEditorTerminals.ts";
import { drain, osc633 as osc, ScriptedShell } from "../../../../../../TestUtils/scriptedShell.ts";
import { createTestConfigurationService } from "../../../../../../TestUtils/testConfigurationService.ts";
import type { HostRpc, SubprocessRpc } from "../../../../api/common/extHostProtocol.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { createTerminalNamespace, type ITerminalNamespace } from "../../../../api/common/terminalNamespace.ts";
import { EventEmitter, TerminalShellExecutionCommandLineConfidence } from "../../../../api/common/vscodeTypes.ts";
import { makeViewsHarness } from "../../../../browser/parts/views/viewsService.testUtils.ts";
import { ExtensionTerminalAdapter } from "../../../../contrib/terminal/browser/extensionTerminalAdapter.ts";
import { TerminalService } from "../../../../contrib/terminal/browser/terminalService.ts";
import { SHELL_EXECUTION_DATA_DEBOUNCE_MS } from "../../../../contrib/terminal/browser/terminalShellIntegrationRelay.ts";
import { ExtensionPtySession } from "../../../../contrib/terminal/node/extensionPtySession.ts";

import { TerminalCustomer } from "./terminalCustomer.ts";

const PROMPT = `${osc("A")}$ ${osc("B")}`;
/** What the injected bash script writes for one command after its prompt. */
function run(commandLine: string, output: string, exitCode: number, nonce = ""): string {
    return `${commandLine}\r\n${osc(`E;${commandLine};${nonce}`)}${osc("C")}${output}${osc(`D;${String(exitCode)}`)}`;
}

const disposables: { dispose(): void }[] = [];
afterEach(() => {
    for (const d of disposables.splice(0)) d.dispose();
});

function setup() {
    const views = makeViewsHarness();
    const shells: ScriptedShell[] = [];
    const service = new TerminalService(views.service, createTestConfigurationService({}), (o) => {
        const shell = new ScriptedShell(o);
        shells.push(shell);
        return shell;
    });
    disposables.push(service);
    views.service.attachRegisteredContainers();
    const activations: string[] = [];
    const adapter = new ExtensionTerminalAdapter(
        service,
        views.service,
        (o) => new ExtensionPtySession(o),
        new FakeEditorTerminals(service),
        createTestConfigurationService({}),
    );
    adapter.onDidRequestActivation((event) => activations.push(event));
    const customer = new TerminalCustomer(adapter);
    /** A subprocess: its namespace and every message the host sent it. */
    const spawn = (): { ns: ITerminalNamespace; sent: { method: string; params: unknown }[] } => {
        const [a, b] = createInProcessChannelPair();
        const hostRpc = new RpcEndpoint(a) as unknown as HostRpc;
        const sent: { method: string; params: unknown }[] = [];
        const notify = hostRpc.notify.bind(hostRpc);
        vi.spyOn(hostRpc, "notify").mockImplementation((method, params) => {
            sent.push({ method, params });
            notify(method, params);
        });
        const ns = createTerminalNamespace(new RpcEndpoint(b) as unknown as SubprocessRpc);
        disposables.push(customer.attach({ rpc: hostRpc, logger: undefined }));
        customer.pushInitialState();
        return { ns, sent };
    };
    return { service, shells, activations, spawn };
}

/** What an extension saw, in order. */
function record(ns: ITerminalNamespace): string[] {
    const log: string[] = [];
    ns.onDidChangeTerminalShellIntegration(({ terminal, shellIntegration }) => {
        log.push(`changed ${terminal.name} cwd=${shellIntegration.cwd?.fsPath ?? "-"}`);
    });
    ns.onDidStartTerminalShellExecution(({ execution }) => {
        log.push(`start ${execution.commandLine.value}`);
    });
    ns.onDidEndTerminalShellExecution(({ execution, exitCode }) => {
        log.push(`end ${execution.commandLine.value} exit=${String(exitCode)}`);
    });
    return log;
}

async function readAll(stream: AsyncIterable<string> | undefined): Promise<string> {
    if (stream === undefined) throw new Error("no execution to read");
    let out = "";
    for await (const chunk of stream) out += chunk;
    return out;
}

describe("shell integration — over the wire (vscode.window ← host)", () => {
    it("the first command sequence brings Terminal.shellIntegration and onDidChangeTerminalShellIntegration; it keeps its identity", async () => {
        const h = setup();
        const { ns } = h.spawn();
        const log = record(ns);
        h.service.createInstance({ name: "bash" });
        await drain();
        const [terminal] = ns.terminals;
        expect(terminal.shellIntegration).toBeUndefined();

        h.shells[0].feed(`${osc("P;Cwd=/home/me")}${PROMPT}`);
        await drain();
        const integration = terminal.shellIntegration;
        expect(integration).toBeDefined();
        expect(log).toStrictEqual(["changed bash cwd=-", "changed bash cwd=/home/me"]);

        h.shells[0].feed(`${run("cd /tmp", "", 0)}${osc("P;Cwd=/tmp")}${PROMPT}`);
        await drain();
        expect(terminal.shellIntegration).toBe(integration);
        expect(integration?.cwd?.fsPath).toBe("/tmp");
        // The end waits for the read() streams to complete (upstream `flush`): the cwd of the same prompt is already there.
        expect(log.slice(2)).toStrictEqual(["start cd /tmp", "changed bash cwd=/tmp", "end cd /tmp exit=0"]);
    });

    it("activates onTerminalShellIntegration:* and :<shell type> when integration comes alive, before any subprocess", async () => {
        const h = setup();
        h.service.createInstance({ name: "zsh", shellPath: "/usr/bin/zsh" });
        h.service.createInstance({ name: "plain", shellPath: "/bin/bash" });
        await drain();
        expect(h.activations).toStrictEqual([]);
        h.shells[0].feed(PROMPT);
        await drain();
        expect(h.activations).toStrictEqual(["onTerminalShellIntegration:*", "onTerminalShellIntegration:zsh"]);
        // A cwd without a command sequence is not shell integration.
        h.shells[1].feed(osc("P;Cwd=/tmp"));
        await drain();
        expect(h.activations).toHaveLength(2);
    });

    it("an extension pty without a shell type activates only :*", async () => {
        const h = setup();
        const { ns } = h.spawn();
        const write = new EventEmitter<string>();
        ns.createTerminal({
            name: "pty",
            pty: { onDidWrite: write.event, open: () => undefined, close: () => undefined },
        });
        await drain();
        write.fire(PROMPT);
        await drain(10);
        expect(h.activations).toStrictEqual(["onTerminalShellIntegration:*"]);
        expect(ns.terminals[0].shellIntegration).toBeDefined();
    });

    it("start → data → end: command line, confidence, trust, cwd, raw output from the C sequence, exit code", async () => {
        const h = setup();
        const { ns } = h.spawn();
        const log = record(ns);
        h.service.createInstance({ name: "bash" });
        await drain();
        const reads: Promise<string>[] = [];
        let started: vscode.TerminalShellExecution | undefined;
        ns.onDidStartTerminalShellExecution(({ execution }) => {
            started = execution;
            reads.push(readAll(execution.read()));
        });
        const shell = h.shells[0];
        shell.feed(`${osc("P;Cwd=/work")}${PROMPT}`);
        await drain();
        shell.feed(run("echo hi", "hi\r\n", 0, shell.nonce));
        shell.feed(PROMPT);
        await drain(SHELL_EXECUTION_DATA_DEBOUNCE_MS);
        shell.feed(run("false", "", 1));
        await drain(SHELL_EXECUTION_DATA_DEBOUNCE_MS);

        expect(log.slice(2)).toStrictEqual(["start echo hi", "end echo hi exit=0", "start false", "end false exit=1"]);
        expect(await reads[0]).toBe(`${osc("C")}hi\r\n`);
        expect(await reads[1]).toBe(osc("C"));
        expect(started?.commandLine).toStrictEqual({
            value: "false",
            confidence: TerminalShellExecutionCommandLineConfidence.High,
            isTrusted: false,
        });
        expect(started?.cwd?.fsPath).toBe("/work");
    });

    it("a command line with the terminal's nonce is trusted; a line read from the buffer has low or medium confidence", async () => {
        const h = setup();
        const { ns } = h.spawn();
        const lines: vscode.TerminalShellExecutionCommandLine[] = [];
        ns.onDidEndTerminalShellExecution(({ execution }) => lines.push(execution.commandLine));
        h.service.createInstance({ name: "bash" });
        await drain();
        const shell = h.shells[0];
        shell.feed(`${PROMPT}${run("ls", "", 0, shell.nonce)}`);
        // Without `E`: the line is the cells between B and C; a prompt to the left makes it medium.
        shell.feed(`${PROMPT}pwd\r\n${osc("C")}${osc("D;0")}`);
        shell.feed(`${osc("B")}date\r\n${osc("C")}${osc("D;0")}`);
        await drain(SHELL_EXECUTION_DATA_DEBOUNCE_MS);
        expect(lines).toStrictEqual([
            { value: "ls", confidence: TerminalShellExecutionCommandLineConfidence.High, isTrusted: true },
            { value: "pwd", confidence: TerminalShellExecutionCommandLineConfidence.Medium, isTrusted: false },
            { value: "date", confidence: TerminalShellExecutionCommandLineConfidence.Low, isTrusted: false },
        ]);
    });

    it("TerminalOptions.shellIntegrationNonce is the shell's VSCODE_NONCE", async () => {
        const h = setup();
        const { ns } = h.spawn();
        ns.createTerminal({ name: "own", shellIntegrationNonce: "n-1" });
        await drain();
        expect(h.shells[0].sessionOptions.shellIntegrationNonce).toBe("n-1");
        expect(h.shells[0].nonce).toBe("n-1");
    });

    it("an extension pty's own nonce makes its sequences trusted", async () => {
        const h = setup();
        const { ns } = h.spawn();
        const ends: vscode.TerminalShellExecutionCommandLine[] = [];
        ns.onDidEndTerminalShellExecution(({ execution }) => ends.push(execution.commandLine));
        const write = new EventEmitter<string>();
        ns.createTerminal({
            name: "pty",
            pty: { onDidWrite: write.event, open: () => undefined, close: () => undefined },
            shellIntegrationNonce: "pty-nonce",
        });
        await drain();
        write.fire(`${PROMPT}${run("go", "", 0, "pty-nonce")}`);
        await drain(10);
        expect(ends.map((line) => line.isTrusted)).toStrictEqual([true]);
    });

    it("output is batched: pieces within the debounce window are one message, all of them before the end", async () => {
        const h = setup();
        const { sent } = h.spawn();
        h.service.createInstance({ name: "bash" });
        await drain();
        const shell = h.shells[0];
        shell.feed(`${PROMPT}${osc("E;make;")}${osc("C")}`);
        shell.feed("one\r\n");
        shell.feed("two\r\n");
        await drain(SHELL_EXECUTION_DATA_DEBOUNCE_MS * 2);
        shell.feed("three\r\n");
        shell.feed(osc("D;2"));
        await drain();
        const id = h.service.getInstances()[0].id;
        expect(sent.filter((m) => m.method.startsWith("terminal.shell"))).toStrictEqual([
            { method: "terminal.shellIntegration.changed", params: { id, supportsExecuteCommand: true } },
            {
                method: "terminal.shellExecution.start",
                params: {
                    id,
                    supportsExecuteCommand: true,
                    commandLine: { value: "make", confidence: 2, isTrusted: false },
                },
            },
            { method: "terminal.shellExecution.data", params: { id, data: `${osc("C")}one\r\ntwo\r\n` } },
            { method: "terminal.shellExecution.data", params: { id, data: "three\r\n" } },
            {
                method: "terminal.shellExecution.end",
                params: { id, commandLine: { value: "make", confidence: 2, isTrusted: false }, exitCode: 2 },
            },
        ]);
    });

    it("the environment the shell reports reaches shellIntegration.env with onDidChangeTerminalShellIntegration", async () => {
        const h = setup();
        const { ns, sent } = h.spawn();
        const log = record(ns);
        h.service.createInstance({ name: "bash" });
        await drain();
        const shell = h.shells[0];
        shell.feed(
            `${PROMPT}${osc(`EnvSingleStart;1;${shell.nonce}`)}${osc(`EnvSingleEntry;HOME;/home/me;${shell.nonce}`)}`,
        );
        shell.feed(osc(`EnvSingleEnd;${shell.nonce}`));
        await drain();
        const env = (ns.terminals[0].shellIntegration as unknown as { env: unknown }).env;
        expect(env).toStrictEqual({ isTrusted: true, value: { HOME: "/home/me" } });
        expect(log).toStrictEqual(["changed bash cwd=-", "changed bash cwd=-"]);
        expect(sent.find((m) => m.method === "terminal.shellIntegration.env")?.params).toStrictEqual({
            id: h.service.getInstances()[0].id,
            env: { HOME: "/home/me" },
            isTrusted: true,
        });
    });

    it("a subprocess started later sees the live integration with its cwd and environment", async () => {
        const h = setup();
        h.service.createInstance({ name: "bash" });
        await drain();
        const shell = h.shells[0];
        shell.feed(`${osc("P;Cwd=/srv")}${PROMPT}${osc('EnvJson;{"A":"1"};' + shell.nonce)}`);
        await drain();
        const { ns } = h.spawn();
        await drain();
        const integration = ns.terminals[0].shellIntegration;
        expect(integration?.cwd?.fsPath).toBe("/srv");
        expect((integration as unknown as { env: unknown }).env).toStrictEqual({ isTrusted: true, value: { A: "1" } });
    });

    it("an adapter created after the integration came alive reports it to a new subprocess", async () => {
        const h = setup();
        h.service.createInstance({ name: "bash" });
        await drain();
        h.shells[0].feed(`${osc("P;Cwd=/late")}${PROMPT}`);
        await drain();
        const late = new ExtensionTerminalAdapter(
            h.service,
            makeViewsHarness().service,
            (o) => new ExtensionPtySession(o),
            new FakeEditorTerminals(h.service),
            createTestConfigurationService({}),
        );
        const id = h.service.getInstances()[0].id;
        expect(late.snapshot().shellIntegrations).toStrictEqual([
            { integration: { id, supportsExecuteCommand: true }, cwd: { id, cwd: "/late" } },
        ]);
    });

    it("executeCommand sends the line with Enter and returns the execution the start event then carries", async () => {
        const h = setup();
        const { ns } = h.spawn();
        h.service.createInstance({ name: "bash" });
        await drain();
        const shell = h.shells[0];
        shell.feed(PROMPT);
        await drain();
        const integration = ns.terminals[0].shellIntegration;
        if (integration === undefined) throw new Error("no shell integration");
        const starts: vscode.TerminalShellExecution[] = [];
        const ends: vscode.TerminalShellExecutionEndEvent[] = [];
        ns.onDidStartTerminalShellExecution(({ execution }) => starts.push(execution));
        ns.onDidEndTerminalShellExecution((e) => ends.push(e));

        const execution = integration.executeCommand("claude");
        expect(execution.commandLine).toStrictEqual({
            value: "claude",
            confidence: TerminalShellExecutionCommandLineConfidence.High,
            isTrusted: true,
        });
        const output = readAll(execution.read());
        await drain();
        expect(shell.input).toStrictEqual(["claude\r"]);
        shell.feed(run("claude", "bye\r\n", 127, shell.nonce));
        await drain(SHELL_EXECUTION_DATA_DEBOUNCE_MS);
        expect(starts).toStrictEqual([execution]);
        expect(ends.map((e) => [e.execution, e.execution.commandLine.value, e.exitCode])).toStrictEqual([
            [execution, "claude", 127],
        ]);
        expect(await output).toBe(`${osc("C")}bye\r\n`);
    });

    it("executeCommand(executable, args) quotes an argument with whitespace and no quotes", async () => {
        const h = setup();
        const { ns } = h.spawn();
        h.service.createInstance({ name: "bash" });
        await drain();
        h.shells[0].feed(PROMPT);
        await drain();
        const execution = ns.terminals[0].shellIntegration?.executeCommand("git", ["commit", "-m", "a b", "'c d'"]);
        expect(execution?.commandLine.value).toBe(`git commit -m "a b" 'c d'`);
        await drain();
        expect(h.shells[0].input).toStrictEqual([`git commit -m "a b" 'c d'\r`]);
    });

    it("a task terminal has shell integration but no executeCommand", async () => {
        const h = setup();
        const { ns } = h.spawn();
        h.service.createInstance({ name: "task", isFeatureTerminal: true });
        await drain();
        h.shells[0].feed(PROMPT);
        await drain();
        const integration = ns.terminals[0].shellIntegration;
        expect(integration).toBeDefined();
        expect(() => integration?.executeCommand("ls")).toThrow(
            "This terminal does not support the executeCommand API.",
        );
    });

    it("a start without its end ends the open execution without a code first", async () => {
        const h = setup();
        const { ns } = h.spawn();
        const log = record(ns);
        h.service.createInstance({ name: "bash" });
        await drain();
        const shell = h.shells[0];
        shell.feed(`${PROMPT}${osc("E;sleep 9;")}${osc("C")}`);
        await drain();
        // A relaunch: the new process reports a new command while the old one never ended.
        shell.shellIntegration.reset();
        shell.feed(`${PROMPT}${run("ls", "", 0)}`);
        await drain(SHELL_EXECUTION_DATA_DEBOUNCE_MS);
        expect(log.slice(1)).toStrictEqual([
            "start sleep 9",
            "changed bash cwd=-",
            "end sleep 9 exit=undefined",
            "start ls",
            "end ls exit=0",
        ]);
    });

    it("read() late in the execution gets the data from then on; after the end it is empty", async () => {
        const h = setup();
        const { ns } = h.spawn();
        h.service.createInstance({ name: "bash" });
        await drain();
        let execution: vscode.TerminalShellExecution | undefined;
        ns.onDidStartTerminalShellExecution((e) => {
            execution = e.execution;
        });
        const shell = h.shells[0];
        shell.feed(`${PROMPT}${osc("E;cat;")}${osc("C")}early\r\n`);
        await drain(SHELL_EXECUTION_DATA_DEBOUNCE_MS);
        const late = readAll(execution?.read());
        shell.feed(`late\r\n${osc("D;0")}`);
        await drain(SHELL_EXECUTION_DATA_DEBOUNCE_MS);
        expect(await late).toBe("late\r\n");
        expect(await readAll(execution?.read())).toBe("");
    });

    it("closing the terminal ends the running execution without a code and completes its read() before onDidCloseTerminal", async () => {
        const h = setup();
        const { ns } = h.spawn();
        const log = record(ns);
        ns.onDidCloseTerminal((t) => log.push(`closed ${t.name}`));
        h.service.createInstance({ name: "bash" });
        await drain();
        let output: Promise<string> | undefined;
        ns.onDidStartTerminalShellExecution(({ execution }) => {
            output = readAll(execution.read());
        });
        h.shells[0].feed(`${PROMPT}${osc("E;top;")}${osc("C")}`);
        await drain(SHELL_EXECUTION_DATA_DEBOUNCE_MS);
        h.service.closeInstance(h.service.getInstances()[0].id);
        await drain();
        expect(log.slice(1)).toStrictEqual(["start top", "end top exit=undefined", "closed bash"]);
        expect(await output).toBe(osc("C"));
    });

    it("a terminal whose shell sends no sequences has no shellIntegration and fires nothing", async () => {
        const h = setup();
        const { ns, sent } = h.spawn();
        const log = record(ns);
        h.service.createInstance({ name: "sh" });
        await drain();
        h.shells[0].feed("$ ls\r\nfile\r\n$ ");
        await drain(SHELL_EXECUTION_DATA_DEBOUNCE_MS);
        expect(ns.terminals[0].shellIntegration).toBeUndefined();
        expect(log).toStrictEqual([]);
        expect(sent.filter((m) => m.method.startsWith("terminal.shell"))).toStrictEqual([]);
    });
});
