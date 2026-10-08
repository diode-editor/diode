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

describe("window.createTerminal — формы вызова уходят одним terminal.create", () => {
    it("позиционная форма: имя, шелл и аргументы; метки монотонны", () => {
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

    it("TerminalOptions: cwd-Uri → путь, env без undefined, строковые shellArgs режутся по пробелам", () => {
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

    it("strictEnv/hideFromUser: false не уезжают; пустой env уезжает пустым", () => {
        const { ns, sent } = setup();
        ns.createTerminal({ strictEnv: false, hideFromUser: false, env: {} });
        expect(sent("terminal.create")).toStrictEqual([{ extHostId: 1, env: {} }]);
    });

    it("терминал виден в terminals сразу, имя — заданное, creationOptions заморожены", () => {
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

describe("Terminal — методы", () => {
    it("свой терминал адресуется меткой: sendText с Enter по умолчанию, show/hide/dispose", () => {
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

    it("после dispose методы бросают, как `_checkDisposed` эталона", () => {
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

    it("чужой терминал (шелл человека) адресуется хостовым id", () => {
        const { ns, stub } = setup();
        stub.fire("terminal.opened", { id: 7, name: "bash", launch: {} });
        stub.notifies.length = 0;
        ns.terminals[0].sendText("pwd");
        expect(stub.notifies).toStrictEqual([
            { method: "terminal.sendText", params: { terminal: { id: 7 }, text: "pwd", shouldExecute: true } },
        ]);
    });
});

describe("события от хоста", () => {
    it("opened своего терминала: тот же объект, имя от хоста, pid; событие одно", async () => {
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

    it("opened чужого терминала: новый объект в конце списка, creationOptions из launch", async () => {
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

    it("opened с меткой, которой нет, — чужой терминал; битый конверт игнорируется", () => {
        const { ns, stub } = setup();
        stub.fire("terminal.opened", { id: 1, extHostId: 99, name: "x", launch: {} });
        stub.fire("terminal.opened", { name: "no id" });
        stub.fire("terminal.opened", null);
        expect(ns.terminals.map((t) => t.name)).toStrictEqual(["x"]);
        expect(ns.terminals[0].creationOptions).toStrictEqual({});
    });

    it("closed: exitStatus с кодом и причиной, выбывание из списка, событие; pid без открытия — undefined", async () => {
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

        // Метка закрытого терминала больше ничего не значит: opened с ней — чужой.
        stub.fire("terminal.opened", { id: 6, extHostId: 1, name: "other", launch: {} });
        expect(ns.terminals).toHaveLength(1);
        expect(ns.terminals[0]).not.toBe(terminal);
        expect(ns.terminals[0].name).toBe("other");
    });

    it("closed без кода и с незнакомой причиной — code undefined, reason Unknown; чужой id — мимо", () => {
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
    ])("причина %s → TerminalExitReason", (reason, expected) => {
        const { ns, stub } = setup();
        stub.fire("terminal.opened", { id: 1, name: "a", launch: {} });
        const [a] = ns.terminals;
        stub.fire("terminal.closed", { id: 1, reason });
        expect(a.exitStatus?.reason).toBe(expected);
    });

    it("activeChanged: активный и событие только на смене; незнакомый id не меняет; null — нет активного", () => {
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

        // Закрытый терминал из адресов выбыл: активным его уже не сделать.
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

describe("pty расширения — сторона субпроцесса", () => {
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

    it("create уезжает меткой с pty: true и именем; шелловых опций нет", () => {
        const { ns, sent } = setup();
        const { pty } = makePty();
        const terminal = ns.createTerminal({ name: "log", pty });
        expect(sent("terminal.create")).toStrictEqual([{ extHostId: 1, pty: true, name: "log" }]);
        expect(terminal.name).toBe("log");
        expect((terminal.creationOptions as vscode.ExtensionTerminalOptions).pty).toBe(pty);
    });

    it("start/resize/input: битый конверт, незнакомый id и терминал без pty — мимо", () => {
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

    it("вывод склеивается окном и уходит одним pty.data; выход — с кодом, без кода — без поля; после закрытия — тишина", async () => {
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

        // Выход досылает склейку сразу; пустую — не шлёт.
        write.fire("z");
        close.fire(4);
        close.fire(undefined);
        expect(sent("terminal.pty.data")).toHaveLength(2);
        expect(JSON.parse(JSON.stringify(sent("terminal.pty.exit")))).toStrictEqual([
            { terminal: { extHostId: 1 }, code: 4 },
            { terminal: { extHostId: 1 } },
        ]);

        // Закрытие инстанса: несработавший таймер снят, слушатели отписаны.
        write.fire("late");
        stub.fire("terminal.closed", { id: 1, reason: "process" });
        write.fire("later");
        await new Promise((r) => setTimeout(r, 20));
        expect(sent("terminal.pty.data")).toHaveLength(2);
    });
});
