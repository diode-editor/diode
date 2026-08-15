import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { IDisposable } from "@tuidom/core/common/disposable";
import { registerAndActivate } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import { NULL_COMMAND_SERVICE } from "../../../api/common/iCommandService.ts";
import type {
    IActiveEditorMeta,
    IActiveEditorSelections,
    IEditorOptionsPatch,
    IEditorOptionsService,
    IEditorOptionsState,
} from "../../../api/common/iEditorOptionsService.ts";
import type { IProtocolMessage, IRequestMessage } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost, type IExtensionHostConfigProvider } from "./extensionHost.ts";
import type { IExtensionRegistration } from "./iExtensionEntry.ts";

// `spawn` is the only side effect we need to control; everything else (IPC channel,
// RPC endpoint) runs for real against the in-memory FakeChild below.
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
const { spawn } = await import("node:child_process");
const spawnMock = vi.mocked(spawn);

/** A minimal in-memory stand-in for a forked ChildProcess speaking the RPC envelope protocol. */
class FakeChild extends EventEmitter {
    public exitCode: number | null = null;
    public killed = false;
    public stdout: FakeStream | null = null;
    public stderr: FakeStream | null = null;
    public readonly sent: IProtocolMessage[] = [];
    public readonly signals: string[] = [];

    /** When true, auto-replies to host→child requests with a `res` envelope. */
    public autoRespond = true;
    /** Optional override: simulate the child exiting in response to a SIGTERM/SIGKILL. */
    public exitOnSignal: string | null = null;
    /** Optional override: simulate the child exiting when it receives `host.shutdown`. */
    public exitOnShutdown = false;

    public send(message: IProtocolMessage): boolean {
        this.sent.push(message);
        if (message.kind === "req" && this.autoRespond) {
            const isShutdown = message.method === "host.shutdown";
            queueMicrotask(() => {
                this.emit("message", { kind: "res", id: message.id, result: null });
                if (isShutdown && this.exitOnShutdown) this.simulateExit(0);
            });
        }
        return true;
    }

    public kill(signal?: string): boolean {
        this.signals.push(signal ?? "SIGTERM");
        this.killed = true;
        if (this.exitOnSignal !== null && (signal ?? "SIGTERM") === this.exitOnSignal) {
            this.simulateExit(0, signal ?? null);
        }
        return true;
    }

    /** Simulate the subprocess announcing readiness. */
    public emitReady(): void {
        this.emit("message", { kind: "notif", method: "host.ready", params: undefined });
    }

    /** Simulate the subprocess sending a request/notification to the host. */
    public receiveFromHostPeer(message: IProtocolMessage): void {
        this.emit("message", message);
    }

    public simulateExit(code: number | null, signal: string | null = null): void {
        this.exitCode = code;
        this.emit("exit", code, signal);
    }
}

class FakeStream extends EventEmitter {
    public encoding: string | null = null;
    public setEncoding(enc: string): this {
        this.encoding = enc;
        return this;
    }
}

class FakeEditorOptions implements IEditorOptionsService {
    public options: IEditorOptionsState | null = { tabSize: 4, insertSpaces: true };
    public lastPatch: IEditorOptionsPatch | null = null;
    public filePath: string | null = "/active.ts";
    private cb: ((meta: IActiveEditorMeta) => void) | null = null;
    private selectionCb: ((selections: IActiveEditorSelections) => void) | null = null;

    public getActiveEditorOptions(): IEditorOptionsState | null {
        return this.options;
    }
    public setActiveEditorOptions(patch: IEditorOptionsPatch): void {
        this.lastPatch = patch;
    }
    public getActiveEditorFilePath(): string | null {
        return this.filePath;
    }
    public getActiveEditorMeta(): IActiveEditorMeta {
        return {
            uri: this.filePath === null ? null : Uri.file(this.filePath).toString(),
            languageId: null,
            isDirty: false,
            encoding: null,
            eol: null,
            selection: null,
        };
    }
    public onActiveEditorChanged(cb: (meta: IActiveEditorMeta) => void): IDisposable {
        this.cb = cb;
        return {
            dispose: (): void => {
                this.cb = null;
            },
        };
    }
    public onActiveEditorSelectionChanged(cb: (selections: IActiveEditorSelections) => void): IDisposable {
        this.selectionCb = cb;
        return {
            dispose: (): void => {
                this.selectionCb = null;
            },
        };
    }
    public setActiveEditorSelections(): void {}
    public applyActiveEditorEdits(): boolean {
        return false;
    }
    public fireSelectionChanged(selections: IActiveEditorSelections): void {
        this.selectionCb?.(selections);
    }
    public fireActiveEditorChanged(p: string | null): void {
        this.cb?.({
            uri: p === null ? null : Uri.file(p).toString(),
            languageId: null,
            isDirty: false,
            encoding: null,
            eol: null,
            selection: null,
        });
    }
}

const spawnArgs = () => ({ command: "node", args: ["host.js"] });

function makeReg(id: string, mainPath: string): IExtensionRegistration {
    return { id, manifest: { name: id, publisher: "test", version: "0.0.1" }, mainPath };
}

function makeLogger() {
    return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

async function waitUntil(pred: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (pred()) return;
        await new Promise((r) => setTimeout(r, 5));
    }
    if (!pred()) throw new Error("waitUntil timed out");
}

/** Spawn a host whose subprocess becomes ready on the next microtask. */
function spawnReadyHost(
    child: FakeChild,
    editorOptions: FakeEditorOptions,
    options = {},
    commandService: ICommandService = NULL_COMMAND_SERVICE,
) {
    spawnMock.mockReturnValue(child as never);
    queueMicrotask(() => {
        child.emitReady();
    });
    return new ExtensionHost(editorOptions, commandService, { spawnArgs, ...options });
}

/** Records execute/registerProxy calls for asserting the host commands bridge. */
class FakeCommandService implements ICommandService {
    public readonly executed: { id: string; args: readonly unknown[] }[] = [];
    public executeResult: unknown = "core-result";
    public executeThrows: string | null = null;
    /** Every proxy ever registered (kept across re-registers to observe dispose). */
    public readonly proxies: { id: string; invoke: (args: readonly unknown[]) => unknown; disposed: boolean }[] = [];

    public execute(id: string, args: readonly unknown[]): unknown {
        this.executed.push({ id, args });
        if (this.executeThrows !== null) throw new Error(this.executeThrows);
        return this.executeResult;
    }

    public registerProxy(id: string, invoke: (args: readonly unknown[]) => unknown): IDisposable {
        const entry = { id, invoke, disposed: false };
        this.proxies.push(entry);
        return {
            dispose: (): void => {
                entry.disposed = true;
            },
        };
    }

    public last(id: string): { id: string; invoke: (args: readonly unknown[]) => unknown; disposed: boolean } {
        const found = [...this.proxies].reverse().find((p) => p.id === id);
        if (found === undefined) throw new Error(`no proxy for "${id}"`);
        return found;
    }
}

afterEach(() => {
    spawnMock.mockReset();
});

describe("ExtensionHost — registration lifecycle", () => {
    it("lazily spawns the subprocess and activates an extension", async () => {
        const child = new FakeChild();
        const editorOptions = new FakeEditorOptions();
        const host = spawnReadyHost(child, editorOptions);

        const reg = await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        expect(spawnMock).toHaveBeenCalledOnce();
        expect(host.hasExtension("ext.a")).toBe(true);
        expect(host.extensionCount).toBe(1);
        // host.activateExtension request was sent to the subprocess
        expect(child.sent.some((m) => m.kind === "req" && m.method === "host.activateExtension")).toBe(true);
        // initial active editor state pushed after ready
        expect(child.sent.some((m) => m.kind === "notif" && m.method === "editor.activeEditorChanged")).toBe(true);

        reg.dispose();
        await waitUntil(() => !host.hasExtension("ext.a"));
        expect(host.hasExtension("ext.a")).toBe(false);
    });

    it("reuses the subprocess for a second extension", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());

        await registerAndActivate(host, makeReg("ext.a", "/a.js"));
        await registerAndActivate(host, makeReg("ext.b", "/b.js"));

        expect(spawnMock).toHaveBeenCalledOnce();
        expect(host.extensionCount).toBe(2);
    });

    it("rejects a duplicate registration", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        host.registerExtension(makeReg("ext.a", "/a.js"));

        expect(() => host.registerExtension(makeReg("ext.a", "/a.js"))).toThrow(/already registered/);
    });

    it("rejects registration after dispose", async () => {
        const child = new FakeChild();
        child.exitOnShutdown = true;
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));
        host.dispose();

        expect(() => host.registerExtension(makeReg("ext.b", "/b.js"))).toThrow(/disposed/);
    });

    it("unregister is a no-op for an unknown extension", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));
        await expect(host.unregisterExtension("nope")).resolves.toBeUndefined();
    });

    it("registration dispose() is a no-op once the extension is already unregistered", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        const reg = await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        await host.unregisterExtension("ext.a");
        expect(host.hasExtension("ext.a")).toBe(false);
        const sentBefore = child.sent.length;

        // The disposable returned by registerExtension must not re-trigger a deactivate.
        reg.dispose();
        await waitUntil(() => true);
        expect(child.sent.length).toBe(sentBefore);
    });

    it("swallows errors from the deactivate request", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { logger });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        // Make the next host→child request (deactivate) reject by replying with an error envelope.
        child.autoRespond = false;
        const promise = host.unregisterExtension("ext.a");
        await waitUntil(() => child.sent.some((m) => m.kind === "req" && m.method === "host.deactivateExtension"));
        const req = child.sent.find(
            (m): m is IRequestMessage => m.kind === "req" && m.method === "host.deactivateExtension",
        )!;
        child.receiveFromHostPeer({ kind: "res", id: req.id, error: { message: "boom" } });

        await expect(promise).resolves.toBeUndefined();
        expect(host.hasExtension("ext.a")).toBe(false);
    });
});

describe("ExtensionHost — editor options RPC handlers", () => {
    it("applies a sanitized editor.setOptions patch from the subprocess", async () => {
        const child = new FakeChild();
        const editorOptions = new FakeEditorOptions();
        const host = spawnReadyHost(child, editorOptions);
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.receiveFromHostPeer({
            kind: "req",
            id: 100,
            method: "editor.setOptions",
            params: { tabSize: 2, insertSpaces: false, bogus: 1 },
        });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 100));
        expect(editorOptions.lastPatch).toEqual({ tabSize: 2, insertSpaces: false });
    });

    it("sanitizes a non-object editor.setOptions payload into an empty patch", async () => {
        const child = new FakeChild();
        const editorOptions = new FakeEditorOptions();
        const host = spawnReadyHost(child, editorOptions);
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        // params is not an object → sanitizeOptionsPatch returns {}
        child.receiveFromHostPeer({ kind: "req", id: 102, method: "editor.setOptions", params: 42 });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 102));
        expect(editorOptions.lastPatch).toEqual({});
    });

    it("drops invalid tabSize / insertSpaces fields from editor.setOptions", async () => {
        const child = new FakeChild();
        const editorOptions = new FakeEditorOptions();
        const host = spawnReadyHost(child, editorOptions);
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        // tabSize is not a positive finite number and insertSpaces is not a boolean → both dropped.
        child.receiveFromHostPeer({
            kind: "req",
            id: 103,
            method: "editor.setOptions",
            params: { tabSize: -1, insertSpaces: "yes" },
        });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 103));
        expect(editorOptions.lastPatch).toEqual({});
    });

    it("answers editor.getOptions with the current state", async () => {
        const child = new FakeChild();
        const editorOptions = new FakeEditorOptions();
        const host = spawnReadyHost(child, editorOptions);
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.receiveFromHostPeer({ kind: "req", id: 101, method: "editor.getOptions", params: undefined });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 101));
        const res = child.sent.find((m) => m.kind === "res" && m.id === 101);
        expect(res).toMatchObject({ result: { tabSize: 4, insertSpaces: true } });
    });

    it("forwards active-editor changes to the subprocess", async () => {
        const child = new FakeChild();
        const editorOptions = new FakeEditorOptions();
        const host = spawnReadyHost(child, editorOptions);
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        editorOptions.fireActiveEditorChanged("/other.ts");

        const notif = child.sent.filter((m) => m.kind === "notif" && m.method === "editor.activeEditorChanged");
        expect(notif.at(-1)).toMatchObject({ params: { uri: Uri.file("/other.ts").toString() } });
    });
});

describe("ExtensionHost — commands RPC handlers", () => {
    async function readyHostWithCommands(child: FakeChild, commandService: FakeCommandService): Promise<ExtensionHost> {
        const host = spawnReadyHost(child, new FakeEditorOptions(), {}, commandService);
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));
        return host;
    }

    it("executes a core command on commands.executeCommand and responds with its result", async () => {
        const child = new FakeChild();
        const commands = new FakeCommandService();
        await readyHostWithCommands(child, commands);

        child.receiveFromHostPeer({
            kind: "req",
            id: 200,
            method: "commands.executeCommand",
            params: { id: "core.do", args: [1, "x"] },
        });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 200));
        expect(commands.executed).toEqual([{ id: "core.do", args: [1, "x"] }]);
        const res = child.sent.find((m) => m.kind === "res" && m.id === 200);
        expect(res).toMatchObject({ result: "core-result" });
    });

    it("defaults args to an empty array when commands.executeCommand omits them", async () => {
        const child = new FakeChild();
        const commands = new FakeCommandService();
        await readyHostWithCommands(child, commands);

        child.receiveFromHostPeer({
            kind: "req",
            id: 210,
            method: "commands.executeCommand",
            params: { id: "core.bare" },
        });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 210));
        expect(commands.executed).toEqual([{ id: "core.bare", args: [] }]);
    });

    it("rejects commands.executeCommand with a non-object payload", async () => {
        const child = new FakeChild();
        await readyHostWithCommands(child, new FakeCommandService());

        child.receiveFromHostPeer({ kind: "req", id: 201, method: "commands.executeCommand", params: 42 });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 201));
        const res = child.sent.find((m) => m.kind === "res" && m.id === 201);
        expect(res).toMatchObject({ error: { message: expect.stringContaining("must be an object") as string } });
    });

    it("rejects commands.executeCommand with a missing/empty id", async () => {
        const child = new FakeChild();
        await readyHostWithCommands(child, new FakeCommandService());

        child.receiveFromHostPeer({ kind: "req", id: 202, method: "commands.executeCommand", params: { id: "" } });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 202));
        const res = child.sent.find((m) => m.kind === "res" && m.id === 202);
        expect(res).toMatchObject({ error: { message: expect.stringContaining("non-empty string") as string } });
    });

    it("registers a proxy on commands.registerCommand whose invoke calls back into the subprocess", async () => {
        const child = new FakeChild();
        const commands = new FakeCommandService();
        await readyHostWithCommands(child, commands);

        child.receiveFromHostPeer({ kind: "notif", method: "commands.registerCommand", params: { id: "ext.cmd" } });
        await waitUntil(() => commands.proxies.some((p) => p.id === "ext.cmd"));

        // Invoking the proxy issues a host→subprocess commands.executeCommand request.
        void commands.last("ext.cmd").invoke([9]);
        await waitUntil(() =>
            child.sent.some(
                (m) =>
                    m.kind === "req" &&
                    m.method === "commands.executeCommand" &&
                    (m.params as { id: string }).id === "ext.cmd",
            ),
        );
        const req = child.sent.find(
            (m) =>
                m.kind === "req" &&
                m.method === "commands.executeCommand" &&
                (m.params as { id: string }).id === "ext.cmd",
        );
        expect(req).toMatchObject({ params: { id: "ext.cmd", args: [9] } });
    });

    it("disposes the previous proxy when the same command id re-registers", async () => {
        const child = new FakeChild();
        const commands = new FakeCommandService();
        await readyHostWithCommands(child, commands);

        child.receiveFromHostPeer({ kind: "notif", method: "commands.registerCommand", params: { id: "ext.dup" } });
        await waitUntil(() => commands.proxies.filter((p) => p.id === "ext.dup").length === 1);
        child.receiveFromHostPeer({ kind: "notif", method: "commands.registerCommand", params: { id: "ext.dup" } });
        await waitUntil(() => commands.proxies.filter((p) => p.id === "ext.dup").length === 2);

        const [first, second] = commands.proxies.filter((p) => p.id === "ext.dup");
        expect(first.disposed).toBe(true);
        expect(second.disposed).toBe(false);
    });

    it("ignores commands.registerCommand with a bad id", async () => {
        const child = new FakeChild();
        const commands = new FakeCommandService();
        await readyHostWithCommands(child, commands);

        child.receiveFromHostPeer({ kind: "notif", method: "commands.registerCommand", params: { id: 123 } });
        child.receiveFromHostPeer({ kind: "notif", method: "commands.registerCommand", params: null });
        await waitUntil(() => true);
        expect(commands.proxies).toEqual([]);
    });

    it("unregisters a proxy on commands.unregisterCommand", async () => {
        const child = new FakeChild();
        const commands = new FakeCommandService();
        await readyHostWithCommands(child, commands);

        child.receiveFromHostPeer({ kind: "notif", method: "commands.registerCommand", params: { id: "ext.gone" } });
        await waitUntil(() => commands.proxies.some((p) => p.id === "ext.gone"));
        child.receiveFromHostPeer({ kind: "notif", method: "commands.unregisterCommand", params: { id: "ext.gone" } });
        await waitUntil(() => commands.last("ext.gone").disposed);

        expect(commands.last("ext.gone").disposed).toBe(true);
    });

    it("tolerates commands.unregisterCommand for an unknown or bad id", async () => {
        const child = new FakeChild();
        const commands = new FakeCommandService();
        await readyHostWithCommands(child, commands);

        // Neither throws; nothing to dispose.
        child.receiveFromHostPeer({ kind: "notif", method: "commands.unregisterCommand", params: { id: "never" } });
        child.receiveFromHostPeer({ kind: "notif", method: "commands.unregisterCommand", params: {} });
        await waitUntil(() => true);
        expect(commands.proxies).toEqual([]);
    });

    it("disposes outstanding proxies when the subprocess shuts down", async () => {
        const child = new FakeChild();
        child.exitOnShutdown = true;
        const commands = new FakeCommandService();
        const host = await readyHostWithCommands(child, commands);

        child.receiveFromHostPeer({ kind: "notif", method: "commands.registerCommand", params: { id: "ext.live" } });
        await waitUntil(() => commands.proxies.some((p) => p.id === "ext.live"));

        host.dispose();
        await waitUntil(() => commands.last("ext.live").disposed);
        expect(commands.last("ext.live").disposed).toBe(true);
    });
});

describe("ExtensionHost — stdout/stderr piping", () => {
    it("forwards full lines from stdout/stderr to the loggers", async () => {
        const child = new FakeChild();
        child.stdout = new FakeStream();
        child.stderr = new FakeStream();
        const stdoutLogger = makeLogger();
        const stderrLogger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { stdoutLogger, stderrLogger });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));
        expect(child.stdout.encoding).toBe("utf8");

        child.stdout.emit("data", "hello\nwor");
        child.stdout.emit("data", "ld\n");
        child.stdout.emit("data", "tail-info"); // partial line buffered until end
        child.stdout.emit("end"); // flushes the buffered tail via info
        expect(stdoutLogger.info).toHaveBeenCalledWith("hello");
        expect(stdoutLogger.info).toHaveBeenCalledWith("world");
        expect(stdoutLogger.info).toHaveBeenCalledWith("tail-info");

        child.stderr.emit("data", "oops\ntail-without-newline");
        child.stderr.emit("end"); // flushes the buffered tail
        expect(stderrLogger.warn).toHaveBeenCalledWith("oops");
        expect(stderrLogger.warn).toHaveBeenCalledWith("tail-without-newline");
    });

    it("skips empty lines and does not log when the buffer is empty at end", async () => {
        const child = new FakeChild();
        child.stdout = new FakeStream();
        const stdoutLogger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { stdoutLogger });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        // A blank line (leading "\n") produces a zero-length `line` → skipped (line 349 false branch).
        // The trailing "\n" leaves the buffer empty, so `end` logs nothing (line 357 false branch).
        child.stdout.emit("data", "\nreal\n");
        child.stdout.emit("end");

        expect(stdoutLogger.info).toHaveBeenCalledTimes(1);
        expect(stdoutLogger.info).toHaveBeenCalledWith("real");
        expect(stdoutLogger.info).not.toHaveBeenCalledWith("");
    });
});

describe("ExtensionHost — subprocess events", () => {
    it("logs subprocess error events", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { logger });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.emit("error", new Error("spawn failed"));

        expect(logger.error).toHaveBeenCalledWith("extension host subprocess error", expect.any(Error));
    });

    it("skips signalling when the subprocess has already exited before dispose", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.simulateExit(0); // subprocess gone before we tear down
        host.dispose();

        await waitUntil(() => child.sent.some((m) => m.kind === "req" && m.method === "host.shutdown"));
        expect(child.signals).toEqual([]); // no SIGTERM/SIGKILL — it was already dead
    });
});

describe("ExtensionHost — readiness failures", () => {
    it("rejects when the subprocess exits before becoming ready", async () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        queueMicrotask(() => {
            child.simulateExit(1);
        });
        const host = new ExtensionHost(new FakeEditorOptions(), NULL_COMMAND_SERVICE, { spawnArgs });

        host.registerExtension(makeReg("ext.a", "/a.js"));
        await expect(host.activateByEvent("*")).rejects.toThrow(/exited before ready/);
    });

    it("rejects when the subprocess does not become ready in time", async () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never); // never emits ready
        const host = new ExtensionHost(new FakeEditorOptions(), NULL_COMMAND_SERVICE, {
            spawnArgs,
            readyTimeoutMs: 20,
        });

        host.registerExtension(makeReg("ext.a", "/a.js"));
        await expect(host.activateByEvent("*")).rejects.toThrow(/did not become ready/);
    });
});

describe("ExtensionHost — shutdown", () => {
    it("shuts down gracefully when the subprocess exits on host.shutdown", async () => {
        const child = new FakeChild();
        child.exitOnShutdown = true;
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        host.dispose();

        await waitUntil(() => child.sent.some((m) => m.kind === "req" && m.method === "host.shutdown"));
        expect(child.signals).toEqual([]); // exited cleanly, no signal needed
        host.dispose(); // idempotent
    });

    it("escalates to SIGTERM when the subprocess ignores host.shutdown but dies on SIGTERM", async () => {
        const child = new FakeChild();
        child.exitOnSignal = "SIGTERM";
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        host.dispose();

        await waitUntil(() => child.signals.includes("SIGTERM"));
        expect(child.signals).not.toContain("SIGKILL");
    });

    it("sends a single SIGTERM when the subprocess ignores both shutdown and the signal", async () => {
        // NOTE: the SIGKILL escalation (ExtensionHost.ts:239-245) is unreachable in practice —
        // child.kill() sets child.killed=true, so the second `!child.killed` guard never passes
        // after SIGTERM. Left uncovered intentionally (latent bug, not forced by a test).
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { shutdownTimeoutMs: 10 });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        host.dispose();

        await waitUntil(() => child.signals.includes("SIGTERM"), 2000);
        expect(child.signals).toEqual(["SIGTERM"]);
    });

    it("disposes cleanly when no subprocess was ever spawned", () => {
        const host = new ExtensionHost(new FakeEditorOptions(), NULL_COMMAND_SERVICE, { spawnArgs });
        expect(() => {
            host.dispose();
        }).not.toThrow();
    });
});

function makeConfigProvider() {
    let cb: ((keys: readonly string[]) => void) | null = null;
    const snapshot = { editor: { tabSize: 2 } };
    const provider: IExtensionHostConfigProvider = {
        getSnapshot: () => snapshot,
        getWorkspaceFolders: () => [{ uri: "/repo", name: "repo", index: 0 }],
        onDidChange: (fn) => {
            cb = fn;
            return {
                dispose: (): void => {
                    cb = null;
                },
            };
        },
    };
    return { provider, fire: (keys: readonly string[]) => cb?.(keys) };
}

describe("ExtensionHost — WP3 config/window bridge", () => {
    it("pushes workspace.initialize after ready and re-pushes on config change", async () => {
        const child = new FakeChild();
        const cfg = makeConfigProvider();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { configuration: cfg.provider });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        const init = child.sent.find((m) => m.kind === "notif" && m.method === "workspace.initialize");
        expect(init).toBeDefined();
        expect((init as { params: unknown }).params).toEqual({
            configuration: { editor: { tabSize: 2 } },
            workspaceFolders: [{ uri: "/repo", name: "repo", index: 0 }],
        });

        cfg.fire(["editor.tabSize"]);
        const changed = child.sent.filter((m) => m.kind === "notif" && m.method === "workspace.configurationChanged");
        expect(changed.at(-1)).toMatchObject({
            params: { configuration: { editor: { tabSize: 2 } }, affectedKeys: ["editor.tabSize"] },
        });

        host.dispose();
    });

    it("routes window.showMessage notifications to the logger by severity", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { logger });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        const send = (severity: string, message: unknown): void => {
            child.receiveFromHostPeer({ kind: "notif", method: "window.showMessage", params: { severity, message } });
        };
        send("error", "boom");
        send("warn", "careful");
        send("info", "fyi");
        send("info", 42); // не-строка → String(message)

        expect(logger.error).toHaveBeenCalledWith("[extension] boom");
        expect(logger.warn).toHaveBeenCalledWith("[extension] careful");
        expect(logger.info).toHaveBeenCalledWith("[extension] fyi");
        expect(logger.info).toHaveBeenCalledWith("[extension] 42");

        host.dispose();
    });

    it("aliases indentSize to tabSize in editor.setOptions (only when tabSize absent)", async () => {
        const child = new FakeChild();
        const editorOptions = new FakeEditorOptions();
        const host = spawnReadyHost(child, editorOptions, {});
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.receiveFromHostPeer({ kind: "req", id: 901, method: "editor.setOptions", params: { indentSize: 3 } });
        await waitUntil(() => editorOptions.lastPatch !== null);
        expect(editorOptions.lastPatch).toEqual({ tabSize: 3 });

        // Явный tabSize имеет приоритет — indentSize игнорируется.
        editorOptions.lastPatch = null;
        child.receiveFromHostPeer({
            kind: "req",
            id: 902,
            method: "editor.setOptions",
            params: { tabSize: 4, indentSize: 8 },
        });
        await waitUntil(() => editorOptions.lastPatch !== null);
        expect(editorOptions.lastPatch).toEqual({ tabSize: 4 });

        host.dispose();
    });
});
