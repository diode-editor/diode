import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createTerminalNamespace } from "./terminalNamespace.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { EventEmitter, TerminalExitReason, Uri } from "./vscodeTypes.ts";

function setup() {
    const stub = makeStubRpc();
    const ns = createTerminalNamespace(stub.rpc);
    const sent = (method: string): unknown[] => stub.notifies.filter((n) => n.method === method).map((n) => n.params);
    return { stub, ns, sent };
}

describe("window.createTerminal — call forms are sent as a single terminal.create", () => {
    it("positional form: name, shell and arguments; tags are monotonic", () => {
        const { ns, sent } = setup();
        ns.createTerminal("cleanup", "/bin/zsh", ["-l"]);
        ns.createTerminal();
        ns.createTerminal("win", "cmd.exe", "/k echo");
        expect(sent("terminal.create")).toStrictEqual([
            { extHostId: 1, name: "cleanup", shellPath: "/bin/zsh", shellArgs: ["-l"] },
            { extHostId: 2 },
            { extHostId: 3, name: "win", shellPath: "cmd.exe", shellArgs: ["/k", "echo"] },
        ]);
        expect(ns.terminals[2].creationOptions).toStrictEqual({
            name: "win",
            shellPath: "cmd.exe",
            shellArgs: "/k echo",
        });
    });

    it("TerminalOptions: cwd Uri → path, env without undefined, string shellArgs split on spaces", () => {
        const { ns, sent } = setup();
        ns.createTerminal({
            name: "build",
            shellArgs: "  -c   'echo hi' ",
            cwd: Uri.file("/work/space"),
            env: { KEEP: "1", DROP: null, SKIP: undefined },
            strictEnv: true,
            hideFromUser: true,
            message: "hello",
        });
        ns.createTerminal({ cwd: "/plain", shellArgs: "single" });
        expect(sent("terminal.create")).toStrictEqual([
            {
                extHostId: 1,
                name: "build",
                shellArgs: ["-c", "'echo", "hi'"],
                cwd: "/work/space",
                env: { KEEP: "1", DROP: null },
                strictEnv: true,
                hideFromUser: true,
                message: "hello",
            },
            { extHostId: 2, shellArgs: ["single"], cwd: "/plain" },
        ]);
    });

    it("strictEnv/hideFromUser: false are not sent; empty env is sent empty", () => {
        const { ns, sent } = setup();
        ns.createTerminal({ strictEnv: false, hideFromUser: false, env: {} });
        expect(sent("terminal.create")).toStrictEqual([{ extHostId: 1, env: {} }]);
    });

    it("location: TerminalLocation as a number, column as is, parent as an address; the rest is not sent", () => {
        const { ns, sent, stub } = setup();
        const own = ns.createTerminal({ name: "own" });
        stub.fire("terminal.opened", { id: 7, name: "bash", launch: { shellPath: "/bin/bash", cwd: "/" } });
        const foreign = ns.terminals[1];
        const gone = ns.createTerminal({ name: "gone" });
        gone.dispose();
        const create = (location: unknown): unknown => {
            ns.createTerminal({ location } as vscode.TerminalOptions);
            return (sent("terminal.create").at(-1) as { location?: unknown }).location;
        };
        expect(create(1)).toBe(1);
        expect(create(2)).toBe(2);
        expect(create(3)).toBeUndefined();
        expect(create({ viewColumn: -2, preserveFocus: true })).toStrictEqual({ viewColumn: -2, preserveFocus: true });
        expect(create({ viewColumn: 1, preserveFocus: false })).toStrictEqual({ viewColumn: 1 });
        expect(create({ parentTerminal: own })).toStrictEqual({ parentTerminal: { extHostId: 1 } });
        expect(create({ parentTerminal: foreign })).toStrictEqual({ parentTerminal: { id: 7 } });
        ns.createTerminal({ location: { parentTerminal: gone } });
        ns.createTerminal({ location: { parentTerminal: {} as vscode.Terminal } });
        for (const params of sent("terminal.create").slice(-2)) expect(params).not.toHaveProperty("location");
    });

    it("terminal appears in terminals immediately, with the given name, creationOptions frozen", () => {
        const { ns } = setup();
        const options: vscode.TerminalOptions = { name: "log" };
        const terminal = ns.createTerminal(options);
        expect(ns.terminals).toStrictEqual([terminal]);
        expect(terminal.name).toBe("log");
        expect(terminal.creationOptions).toBe(options);
        expect(Object.isFrozen(terminal.creationOptions)).toBe(true);
        expect(terminal.exitStatus).toBeUndefined();
        expect(terminal.state).toStrictEqual({ isInteractedWith: false, shell: undefined });
        const bare = ns.createTerminal();
        expect(bare.name).toBe("");
        expect(bare.creationOptions).toStrictEqual({});
    });
});

describe("Terminal — methods", () => {
    it("own terminal is addressed by tag: sendText with Enter by default, show/hide/dispose", () => {
        const { ns, stub } = setup();
        const terminal = ns.createTerminal("t");
        stub.notifies.length = 0;
        terminal.sendText("ls");
        terminal.sendText("partial", false);
        terminal.show();
        terminal.show(true);
        terminal.hide();
        terminal.dispose();
        terminal.dispose();
        const ref = { extHostId: 1 };
        expect(stub.notifies).toStrictEqual([
            { method: "terminal.sendText", params: { terminal: ref, text: "ls", shouldExecute: true } },
            { method: "terminal.sendText", params: { terminal: ref, text: "partial", shouldExecute: false } },
            { method: "terminal.show", params: { terminal: ref, preserveFocus: false } },
            { method: "terminal.show", params: { terminal: ref, preserveFocus: true } },
            { method: "terminal.hide", params: { terminal: ref } },
            { method: "terminal.dispose", params: { terminal: ref } },
        ]);
    });

    it("after dispose methods throw, like upstream `_checkDisposed`", () => {
        const { ns } = setup();
        const terminal = ns.createTerminal("t");
        terminal.dispose();
        expect(() => {
            terminal.sendText("x");
        }).toThrow("Terminal has already been disposed");
        expect(() => {
            terminal.show();
        }).toThrow("Terminal has already been disposed");
        expect(() => {
            terminal.hide();
        }).toThrow("Terminal has already been disposed");
    });

    it("foreign terminal (the user's shell) is addressed by host id", () => {
        const { ns, stub } = setup();
        stub.fire("terminal.opened", { id: 7, name: "bash", launch: {} });
        stub.notifies.length = 0;
        ns.terminals[0].sendText("pwd");
        expect(stub.notifies).toStrictEqual([
            { method: "terminal.sendText", params: { terminal: { id: 7 }, text: "pwd", shouldExecute: true } },
        ]);
    });
});

describe("host events", () => {
    it("opened for own terminal: same object, name from host, pid; one event", async () => {
        const { ns, stub } = setup();
        const onOpen = vi.fn();
        ns.onDidOpenTerminal(onOpen);
        const terminal = ns.createTerminal();
        stub.fire("terminal.opened", { id: 3, extHostId: 1, name: "zsh", pid: 4242, launch: { name: "zsh" } });
        stub.fire("terminal.opened", { id: 3, extHostId: 1, name: "zsh", pid: 4242, launch: {} });
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(onOpen).toHaveBeenCalledWith(terminal);
        expect(ns.terminals).toStrictEqual([terminal]);
        expect(terminal.name).toBe("zsh");
        await expect(terminal.processId).resolves.toBe(4242);
    });

    it("opened for a foreign terminal: new object at the end of the list, creationOptions from launch", async () => {
        const { ns, stub } = setup();
        const own = ns.createTerminal("mine");
        const onOpen = vi.fn();
        ns.onDidOpenTerminal(onOpen);
        stub.fire("terminal.opened", {
            id: 9,
            name: "bash",
            launch: {
                name: "bash",
                shellPath: "/bin/bash",
                shellArgs: ["-i"],
                cwd: "/home/u",
                env: { A: "1" },
                hideFromUser: false,
            },
        });
        expect(ns.terminals).toHaveLength(2);
        const [first, foreign] = ns.terminals;
        expect(first).toBe(own);
        expect(onOpen).toHaveBeenCalledWith(foreign);
        expect(foreign.name).toBe("bash");
        const { cwd, ...options } = foreign.creationOptions as vscode.TerminalOptions;
        expect(options).toStrictEqual({
            name: "bash",
            shellPath: "/bin/bash",
            shellArgs: ["-i"],
            env: { A: "1" },
            hideFromUser: false,
        });
        expect((cwd as vscode.Uri).fsPath).toBe("/home/u");
        await expect(foreign.processId).resolves.toBeUndefined();
    });

    it("opened with an unknown tag is a foreign terminal; a malformed envelope is ignored", () => {
        const { ns, stub } = setup();
        stub.fire("terminal.opened", { id: 1, extHostId: 99, name: "x", launch: {} });
        stub.fire("terminal.opened", { name: "no id" });
        stub.fire("terminal.opened", null);
        expect(ns.terminals.map((t) => t.name)).toStrictEqual(["x"]);
        expect(ns.terminals[0].creationOptions).toStrictEqual({});
    });

    it("closed: exitStatus with code and reason, removal from the list, event; pid without opened is undefined", async () => {
        const { ns, stub } = setup();
        const onClose = vi.fn();
        ns.onDidCloseTerminal(onClose);
        const terminal = ns.createTerminal("t");
        stub.fire("terminal.opened", { id: 5, extHostId: 1, name: "t", launch: {} });
        stub.fire("terminal.closed", { id: 5, code: 3, reason: "process" });
        expect(ns.terminals).toStrictEqual([]);
        expect(onClose).toHaveBeenCalledWith(terminal);
        expect(terminal.exitStatus).toStrictEqual({ code: 3, reason: TerminalExitReason.Process });
        await expect(terminal.processId).resolves.toBeUndefined();

        // A closed terminal's tag means nothing anymore: an opened event with it is a foreign terminal.
        stub.fire("terminal.opened", { id: 6, extHostId: 1, name: "other", launch: {} });
        expect(ns.terminals).toHaveLength(1);
        expect(ns.terminals[0]).not.toBe(terminal);
        expect(ns.terminals[0].name).toBe("other");
    });

    it("closed without code and with an unknown reason: code undefined, reason Unknown; foreign id is ignored", () => {
        const { ns, stub } = setup();
        const onClose = vi.fn();
        ns.onDidCloseTerminal(onClose);
        stub.fire("terminal.opened", { id: 1, name: "a", launch: {} });
        stub.fire("terminal.opened", { id: 2, name: "b", launch: {} });
        const [a] = ns.terminals;
        stub.fire("terminal.closed", { id: 404, reason: "process" });
        stub.fire("terminal.closed", { reason: "process" });
        expect(onClose).not.toHaveBeenCalled();
        stub.fire("terminal.closed", { id: 1, reason: "alien" });
        expect(a.exitStatus).toStrictEqual({ code: undefined, reason: TerminalExitReason.Unknown });
        expect(ns.terminals.map((t) => t.name)).toStrictEqual(["b"]);
    });

    it.each([
        ["user", TerminalExitReason.User],
        ["extension", TerminalExitReason.Extension],
        ["shutdown", TerminalExitReason.Shutdown],
        ["unknown", TerminalExitReason.Unknown],
    ])("reason %s → TerminalExitReason", (reason, expected) => {
        const { ns, stub } = setup();
        stub.fire("terminal.opened", { id: 1, name: "a", launch: {} });
        const [a] = ns.terminals;
        stub.fire("terminal.closed", { id: 1, reason });
        expect(a.exitStatus?.reason).toBe(expected);
    });

    it("activeChanged: active terminal and event only on change; unknown id changes nothing; null means none active", () => {
        const { ns, stub } = setup();
        const onActive = vi.fn();
        ns.onDidChangeActiveTerminal(onActive);
        stub.fire("terminal.opened", { id: 1, name: "a", launch: {} });
        const [a] = ns.terminals;
        expect(ns.activeTerminal).toBeUndefined();

        stub.fire("terminal.activeChanged", { id: 1 });
        stub.fire("terminal.activeChanged", { id: 1 });
        expect(ns.activeTerminal).toBe(a);
        expect(onActive).toHaveBeenCalledTimes(1);
        expect(onActive).toHaveBeenLastCalledWith(a);

        stub.fire("terminal.activeChanged", { id: 77 });
        expect(ns.activeTerminal).toBe(a);

        // A closed terminal is no longer addressable: it cannot become active again.
        stub.fire("terminal.opened", { id: 2, name: "b", launch: {} });
        stub.fire("terminal.closed", { id: 2, reason: "process" });
        stub.fire("terminal.activeChanged", { id: 2 });
        expect(ns.activeTerminal).toBe(a);

        stub.fire("terminal.activeChanged", { id: null });
        expect(ns.activeTerminal).toBeUndefined();
        expect(onActive).toHaveBeenCalledTimes(2);
        expect(onActive).toHaveBeenLastCalledWith(undefined);
        stub.fire("terminal.activeChanged", {});
        expect(onActive).toHaveBeenCalledTimes(2);
    });
});

describe("extension pty — subprocess side", () => {
    function makePty() {
        const log: string[] = [];
        const pty: vscode.Pseudoterminal = {
            onDidWrite: () => ({ dispose: () => undefined }),
            open: () => log.push("open"),
            close: () => log.push("close"),
            handleInput: (data) => log.push(`input ${data}`),
            setDimensions: (d) => log.push(`dims ${String(d.columns)}x${String(d.rows)}`),
        };
        return { pty, log };
    }

    it("create is sent as a tag with pty: true and name; no shell options", () => {
        const { ns, sent } = setup();
        const { pty } = makePty();
        const terminal = ns.createTerminal({ name: "log", pty });
        expect(sent("terminal.create")).toStrictEqual([{ extHostId: 1, pty: true, name: "log" }]);
        expect(terminal.name).toBe("log");
        expect((terminal.creationOptions as vscode.ExtensionTerminalOptions).pty).toBe(pty);
    });

    it("pty without handleInput/setDimensions: input and resize are silent; close() throws, terminal closed", () => {
        const { ns, stub } = setup();
        const pty: vscode.Pseudoterminal = {
            onDidWrite: () => ({ dispose: () => undefined }),
            open: () => undefined,
            close: () => {
                throw new Error("boom");
            },
        };
        const terminal = ns.createTerminal({ name: "min", pty });
        ns.createTerminal("shell");
        stub.fire("terminal.opened", { id: 1, extHostId: 1, name: "min", launch: {} });
        stub.fire("terminal.opened", { id: 2, extHostId: 2, name: "shell", launch: {} });
        stub.fire("terminal.pty.start", { id: 1, cols: 10, rows: 5 });
        expect(() => {
            stub.fire("terminal.pty.input", { id: 1, data: "x" });
            stub.fire("terminal.pty.resize", { id: 1, cols: 12, rows: 6 });
            stub.fire("terminal.closed", { id: 1, reason: "process" });
            stub.fire("terminal.closed", { id: 2, reason: "process" });
        }).not.toThrow();
        expect(terminal.exitStatus?.reason).toBe(TerminalExitReason.Process);
        expect(ns.terminals).toStrictEqual([]);
    });

    it("start/resize/input: malformed envelope, unknown id and terminal without pty are ignored", () => {
        const { ns, stub } = setup();
        const { pty, log } = makePty();
        ns.createTerminal({ name: "log", pty });
        ns.createTerminal("shell");
        stub.fire("terminal.opened", { id: 1, extHostId: 1, name: "log", launch: {} });
        stub.fire("terminal.opened", { id: 2, extHostId: 2, name: "shell", launch: {} });
        for (const method of ["terminal.pty.start", "terminal.pty.resize"]) {
            stub.fire(method, { id: 1, cols: 0, rows: 1 });
            stub.fire(method, { id: 9, cols: 10, rows: 5 });
            stub.fire(method, { id: 2, cols: 10, rows: 5 });
        }
        stub.fire("terminal.pty.input", { id: 1 });
        stub.fire("terminal.pty.input", { id: 9, data: "x" });
        stub.fire("terminal.pty.input", { id: 2, data: "x" });
        expect(log).toStrictEqual([]);
        stub.fire("terminal.pty.start", { id: 1, cols: 10, rows: 5 });
        stub.fire("terminal.pty.resize", { id: 1, cols: 12, rows: 6 });
        stub.fire("terminal.pty.input", { id: 1, data: "x" });
        expect(log).toStrictEqual(["open", "dims 10x5", "dims 12x6", "input x"]);
    });

    it("output is batched per window and sent as one pty.data; exit with code, without code no field; silence after close", async () => {
        const { ns, stub, sent } = setup();
        const write = new EventEmitter<string>();
        const close = new EventEmitter<number | undefined>();
        const pty: vscode.Pseudoterminal = {
            onDidWrite: write.event,
            onDidClose: close.event,
            open: () => undefined,
            close: () => undefined,
        };
        ns.createTerminal({ name: "a", pty });
        stub.fire("terminal.opened", { id: 1, extHostId: 1, name: "a", launch: {} });
        stub.fire("terminal.pty.start", { id: 1, cols: 10, rows: 5 });
        write.fire("x");
        write.fire("y");
        expect(sent("terminal.pty.data")).toStrictEqual([]);
        await new Promise((r) => setTimeout(r, 20));
        expect(sent("terminal.pty.data")).toStrictEqual([{ terminal: { extHostId: 1 }, data: "xy" }]);

        write.fire("z");
        close.fire(4);
        close.fire(undefined);
        expect(sent("terminal.pty.data")).toHaveLength(2);
        expect(JSON.parse(JSON.stringify(sent("terminal.pty.exit")))).toStrictEqual([
            { terminal: { extHostId: 1 }, code: 4 },
            { terminal: { extHostId: 1 } },
        ]);

        write.fire("late");
        stub.fire("terminal.closed", { id: 1, reason: "process" });
        write.fire("later");
        close.fire(0);
        await new Promise((r) => setTimeout(r, 20));
        expect(sent("terminal.pty.data")).toHaveLength(2);
        expect(sent("terminal.pty.exit")).toHaveLength(2);
    });
});

describe("attachPty — CustomExecution task pty to a core terminal", () => {
    function makePty(name: string, log: string[]) {
        const write = new EventEmitter<string>();
        const pty: vscode.Pseudoterminal = {
            onDidWrite: write.event,
            open: (d) => log.push(`${name} open ${String(d?.columns)}x${String(d?.rows)}`),
            close: () => log.push(`${name} close`),
            handleInput: (data) => log.push(`${name} input ${data}`),
        };
        return { pty, write };
    }

    it("starts with the size the host sent before attach; input and output by instance id", async () => {
        const { ns, stub, sent } = setup();
        const log: string[] = [];
        stub.fire("terminal.opened", { id: 5, name: "task", launch: {} });
        stub.fire("terminal.pty.start", { id: 5, cols: 90, rows: 30 });
        stub.fire("terminal.pty.resize", { id: 5, cols: 100, rows: 40 });
        const { pty, write } = makePty("a", log);
        ns.attachPty(5, pty);
        stub.fire("terminal.pty.input", { id: 5, data: "k" });
        write.fire("out");
        await new Promise((r) => setTimeout(r, 20));
        expect(log).toStrictEqual(["a open 100x40", "a input k"]);
        expect(sent("terminal.pty.data")).toStrictEqual([{ terminal: { id: 5 }, data: "out" }]);
    });

    it("without a sent size uses 80×24; re-attach detaches the previous pty without close()", async () => {
        const { ns, stub, sent } = setup();
        const log: string[] = [];
        stub.fire("terminal.opened", { id: 5, name: "task", launch: {} });
        const first = makePty("a", log);
        ns.attachPty(5, first.pty);
        const second = makePty("b", log);
        ns.attachPty(5, second.pty);
        first.write.fire("stale");
        second.write.fire("fresh");
        stub.fire("terminal.pty.input", { id: 5, data: "k" });
        await new Promise((r) => setTimeout(r, 20));
        expect(log).toStrictEqual(["a open 80x24", "b open 80x24", "b input k"]);
        expect(sent("terminal.pty.data")).toStrictEqual([{ terminal: { id: 5 }, data: "fresh" }]);
    });

    it("unknown terminal throws the upstream exception", () => {
        const { ns } = setup();
        expect(() => {
            ns.attachPty(9, makePty("x", []).pty);
        }).toThrow("Cannot resolve terminal with id 9 for virtual process");
    });
});
