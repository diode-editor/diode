import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { registerAndActivate, testRegistration } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
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
import type { IExtensionTaskEvents } from "../../../api/common/iExtensionTaskSink.ts";
import type { IProtocolMessage, IRequestMessage } from "../../../api/common/rpcEndpoint.ts";
import type { IWireTaskExecution } from "../../../api/common/taskWireTypes.ts";

import { ExtensionHost, type IExtensionHostConfigProvider } from "./extensionHost.ts";
import type { IExtensionRegistration } from "./iExtensionEntry.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
const { spawn } = await import("node:child_process");
const spawnMock = vi.mocked(spawn);

class FakeChild extends EventEmitter {
    public exitCode: number | null = null;
    public signalCode: string | null = null;
    public killed = false;
    public stdout: FakeStream | null = null;
    public stderr: FakeStream | null = null;
    public readonly sent: IProtocolMessage[] = [];
    public readonly signals: string[] = [];

    public autoRespond = true;
    public exitOnSignal: string | null = null;
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
            this.simulateExit(null, signal ?? "SIGTERM");
        }
        return true;
    }

    public emitReady(): void {
        this.emit("message", { kind: "notif", method: "host.ready", params: undefined });
    }

    public receiveFromHostPeer(message: IProtocolMessage): void {
        this.emit("message", message);
    }

    public simulateExit(code: number | null, signal: string | null = null): void {
        this.exitCode = code;
        this.signalCode = signal;
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
    /** All live subscribers, as with a real event: leftovers after a respawn are visible. */
    public readonly activeEditorListeners: ((meta: IActiveEditorMeta) => void)[] = [];
    private readonly selectionListeners: ((selections: IActiveEditorSelections) => void)[] = [];

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
        return subscribe(this.activeEditorListeners, cb);
    }
    public onActiveEditorSelectionChanged(cb: (selections: IActiveEditorSelections) => void): IDisposable {
        return subscribe(this.selectionListeners, cb);
    }
    public setActiveEditorSelections(): void {}
    public applyActiveEditorEdits(): boolean {
        return false;
    }
    public applyWorkspaceEdit(): Promise<boolean> {
        return Promise.resolve(false);
    }
    public saveAll(): Promise<boolean> {
        return Promise.resolve(false);
    }
    public save(): Promise<string | null> {
        return Promise.resolve(null);
    }
    public fireSelectionChanged(selections: IActiveEditorSelections): void {
        for (const listener of [...this.selectionListeners]) listener(selections);
    }
    public fireActiveEditorChanged(p: string | null): void {
        const meta: IActiveEditorMeta = {
            uri: p === null ? null : Uri.file(p).toString(),
            languageId: null,
            isDirty: false,
            encoding: null,
            eol: null,
            selection: null,
        };
        for (const listener of [...this.activeEditorListeners]) listener(meta);
    }
}

function subscribe<T>(listeners: T[], listener: T): IDisposable {
    listeners.push(listener);
    return {
        dispose: (): void => {
            const index = listeners.indexOf(listener);
            if (index >= 0) listeners.splice(index, 1);
        },
    };
}

const spawnArgs = () => ({ command: "node", args: ["host.js"] });

function makeReg(id: string, mainPath: string): IExtensionRegistration {
    // Eager: the registration has no default `*`.
    return { id, manifest: { name: id, publisher: "test", version: "0.0.1" }, mainPath, activationEvents: ["*"] };
}

function makeLogger() {
    return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), isEnabled: () => true };
}

async function waitUntil(pred: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (pred()) return;
        await new Promise((r) => setTimeout(r, 5));
    }
    if (!pred()) throw new Error("waitUntil timed out");
}

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

class FakeCommandService implements ICommandService {
    public readonly executed: { id: string; args: readonly unknown[] }[] = [];
    public executeResult: unknown = "core-result";
    public executeThrows: string | null = null;
    /** Not cleared on re-registration, so disposal of the previous ones is visible. */
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

// Producer message shape: the parser on the other side drops garbage, so
// neither the consumer unit tests nor the end-to-end test see it.
describe("ExtensionHost — extension catalog on the wire", () => {
    const catalogs = (child: FakeChild): { extensions: unknown[] }[] =>
        child.sent
            .filter((m) => m.kind === "notif" && m.method === "extensions.catalog")
            .map((m) => (m as { params: { extensions: unknown[] } }).params);

    it("handshake seed carries exactly the registered extensions with their manifests", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        host.registerExtension({
            id: "ext.a",
            manifest: { name: "a", publisher: "ext", version: "1.2.3", displayName: "First" },
            mainPath: "/ext-a/out/main.js",
        });
        host.registerExtension(makeReg("ext.b", "/ext-b/main.js"));
        await host.activateByEvent("*");

        const [seed] = catalogs(child);
        expect(seed.extensions).toEqual([
            {
                id: "ext.a",
                extensionPath: "/ext-a/out",
                packageJSON: { name: "a", publisher: "ext", version: "1.2.3", displayName: "First" },
                isActive: false,
            },
            {
                id: "ext.b",
                extensionPath: "/ext-b",
                packageJSON: { name: "ext.b", publisher: "test", version: "0.0.1" },
                isActive: false,
            },
        ]);
        host.dispose();
    });

    it("activation goes out as a targeted `extensions.activated`, not a new catalog", async () => {
        // Manifests are heavy: never resend the whole list for one flag.
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        host.registerExtension(makeReg("ext.a", "/a.js"));
        const before = catalogs(child).length;
        await host.activateByEvent("*");

        expect(catalogs(child).length).toBe(before + 1); // only the seed on startup
        expect(child.sent.filter((m) => m.kind === "notif" && m.method === "extensions.activated")).toEqual([
            { kind: "notif", method: "extensions.activated", params: { id: "ext.a" } },
        ]);
        host.dispose();
    });

    it("removing an extension re-pushes the catalog without it", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        host.registerExtension(makeReg("ext.a", "/a.js"));
        host.registerExtension(makeReg("ext.b", "/b.js"));
        await host.activateByEvent("*");

        await host.unregisterExtension("ext.a");
        const last = catalogs(child).at(-1);
        expect((last?.extensions as { id: string }[] | undefined)?.map((e) => e.id)).toEqual(["ext.b"]);
        host.dispose();
    });

    it("after subprocess death the whole set carries over and activation state is reset", async () => {
        // Nobody is active at handshake: `isActive: true` would lie to a neighbor reading
        // the catalog in `activate()`. The flag is set by `extensions.activated`.
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        host.registerExtension(makeReg("ext.a", "/a.js"));
        await host.activateByEvent("*");

        const revived = new FakeChild();
        spawnMock.mockReturnValue(revived as never);
        queueMicrotask(() => {
            revived.emitReady();
        });
        child.simulateExit(1);
        await host.activateByEvent("onLanguage:python");

        const [seed] = catalogs(revived);
        expect(seed.extensions).toEqual([
            {
                id: "ext.a",
                extensionPath: "/",
                packageJSON: { name: "ext.a", publisher: "test", version: "0.0.1" },
                isActive: false,
            },
        ]);
        expect(revived.sent.filter((m) => m.kind === "notif" && m.method === "extensions.activated")).toEqual([
            { kind: "notif", method: "extensions.activated", params: { id: "ext.a" } },
        ]);
        host.dispose();
    });
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
        expect(child.sent.some((m) => m.kind === "req" && m.method === "host.activateExtension")).toBe(true);
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

    it("disposeNow kills the subprocess with a signal, synchronously, without waiting for it to exit", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        host.disposeNow();

        // Reloading the window then blocks the event loop: a polite "ask and
        // wait" would never arrive, and the subprocess would live on as an orphan.
        expect(child.signals).toEqual(["SIGKILL"]);
        expect(child.killed).toBe(true);
    });

    it("shutdown waits for a graceful subprocess exit, and disposeNow afterwards kills nothing", async () => {
        const child = new FakeChild();
        child.exitOnShutdown = true;
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        const done = host.shutdown();
        expect(host.shutdown()).toBe(done);
        await done;

        expect(child.sent.some((m) => m.kind === "req" && m.method === "host.shutdown")).toBe(true);
        expect(child.exitCode).toBe(0);
        // The synchronous shutdown phase always calls disposeNow; it leaves a cleanly exited child alone.
        host.disposeNow();
        expect(child.signals).toEqual([]);
    });

    it("disposeNow kills a subprocess that is still exiting after shutdown", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));
        child.autoRespond = false;

        void host.shutdown();
        host.disposeNow();

        expect(child.signals).toEqual(["SIGKILL"]);
    });

    it("extensions of one event activate in parallel: siblings do not wait for each other's activate()", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        host.registerExtension(makeReg("ext.slow", "/slow.js"));
        host.registerExtension(makeReg("ext.fast", "/fast.js"));
        child.autoRespond = false;

        const activation = host.activateByEvent("*");
        await waitUntil(
            () => child.sent.filter((m) => m.kind === "req" && m.method === "host.activateExtension").length === 2,
        );
        const requests = child.sent.filter((m) => m.kind === "req" && m.method === "host.activateExtension");
        expect(host.hasExtension("ext.slow")).toBe(false);
        expect(host.hasExtension("ext.fast")).toBe(false);

        for (const req of requests.reverse()) {
            if (req.kind === "req") child.receiveFromHostPeer({ kind: "res", id: req.id, result: null });
        }
        await activation;
        expect(host.hasExtension("ext.slow")).toBe(true);
        expect(host.hasExtension("ext.fast")).toBe(true);
    });

    it("a failed activate() is logged with its id, the sibling on the same event is activated", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { logger });
        host.registerExtension(makeReg("ext.bad", "/bad.js"));
        host.registerExtension(makeReg("ext.good", "/good.js"));
        child.autoRespond = false;

        const activation = host.activateByEvent("*");
        await waitUntil(
            () => child.sent.filter((m) => m.kind === "req" && m.method === "host.activateExtension").length === 2,
        );
        for (const req of child.sent) {
            if (req.kind !== "req" || req.method !== "host.activateExtension") continue;
            const id = (req.params as { id: string }).id;
            child.receiveFromHostPeer(
                id === "ext.bad"
                    ? { kind: "res", id: req.id, error: { $isError: true, name: "Error", message: "boom", stack: "" } }
                    : { kind: "res", id: req.id, result: null },
            );
        }
        await activation;

        expect(host.hasExtension("ext.bad")).toBe(false);
        expect(host.hasExtension("ext.good")).toBe(true);
        expect(logger.error).toHaveBeenCalledWith('failed to activate extension "ext.bad"', expect.anything());
    });

    it("disposeNow without a running subprocess just disposes the host", () => {
        const host = spawnReadyHost(new FakeChild(), new FakeEditorOptions());

        host.disposeNow();

        expect(() => host.registerExtension(makeReg("ext.a", "/a.js"))).toThrow(/disposed/);
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

        reg.dispose();
        await waitUntil(() => true);
        expect(child.sent.length).toBe(sentBefore);
    });

    it("swallows errors from the deactivate request", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { logger });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.autoRespond = false;
        const promise = host.unregisterExtension("ext.a");
        await waitUntil(() => child.sent.some((m) => m.kind === "req" && m.method === "host.deactivateExtension"));
        const req = child.sent.find(
            (m): m is IRequestMessage => m.kind === "req" && m.method === "host.deactivateExtension",
        )!;
        child.receiveFromHostPeer({
            kind: "res",
            id: req.id,
            error: { $isError: true, name: "Error", message: "boom", stack: "" },
        });

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

        child.receiveFromHostPeer({ kind: "req", id: 102, method: "editor.setOptions", params: 42 });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 102));
        expect(editorOptions.lastPatch).toEqual({});
    });

    it("drops invalid tabSize / insertSpaces fields from editor.setOptions", async () => {
        const child = new FakeChild();
        const editorOptions = new FakeEditorOptions();
        const host = spawnReadyHost(child, editorOptions);
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

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
        child.stdout.emit("data", "tail-info");
        child.stdout.emit("end");
        expect(stdoutLogger.info).toHaveBeenCalledWith("hello");
        expect(stdoutLogger.info).toHaveBeenCalledWith("world");
        expect(stdoutLogger.info).toHaveBeenCalledWith("tail-info");

        child.stderr.emit("data", "oops\ntail-without-newline");
        child.stderr.emit("end");
        expect(stderrLogger.warn).toHaveBeenCalledWith("oops");
        expect(stderrLogger.warn).toHaveBeenCalledWith("tail-without-newline");
    });

    it("skips empty lines and does not log when the buffer is empty at end", async () => {
        const child = new FakeChild();
        child.stdout = new FakeStream();
        const stdoutLogger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { stdoutLogger });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.stdout.emit("data", "\nreal\n");
        child.stdout.emit("end");

        expect(stdoutLogger.info).toHaveBeenCalledTimes(1);
        expect(stdoutLogger.info).toHaveBeenCalledWith("real");
        expect(stdoutLogger.info).not.toHaveBeenCalledWith("");
    });
});

/** The next spawned child announces readiness right after the host subscribes. */
function armNextChild(): FakeChild {
    const child = new FakeChild();
    spawnMock.mockImplementation((() => {
        queueMicrotask(() => {
            child.emitReady();
        });
        return child;
    }) as never);
    return child;
}

function activated(child: FakeChild, id: string): boolean {
    return child.sent.some(
        (m) => m.kind === "req" && m.method === "host.activateExtension" && (m.params as { id: string }).id === id,
    );
}

const DEATH_WARNING = "extension host subprocess died — resetting host state";

describe("ExtensionHost — subprocess death", () => {
    it("spawn subscriptions to core are removed: one listener after respawn, nothing is sent to the dead process", async () => {
        const child = new FakeChild();
        const editorOptions = new FakeEditorOptions();
        const host = spawnReadyHost(child, editorOptions);
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));
        expect(editorOptions.activeEditorListeners).toHaveLength(1);

        child.simulateExit(1);
        expect(editorOptions.activeEditorListeners).toHaveLength(0);

        const next = armNextChild();
        await host.activateByEvent("*");
        expect(editorOptions.activeEditorListeners).toHaveLength(1);

        const sentBefore = child.sent.length;
        editorOptions.fireActiveEditorChanged("/other.ts");

        expect(child.sent).toHaveLength(sentBefore);
        expect(
            next.sent.filter((m) => m.kind === "notif" && m.method === "editor.activeEditorChanged").at(-1),
        ).toMatchObject({ params: { uri: Uri.file("/other.ts").toString() } });
        host.dispose();
    });

    it("death removes extension watchers: the core tree is not watched for the dead process", async () => {
        const child = new FakeChild();
        const watched: string[] = [];
        const disposed: string[] = [];
        const fileWatcher = {
            watch: (base: string) => {
                watched.push(base);
                return { dispose: () => disposed.push(base) };
            },
        };
        const host = spawnReadyHost(child, new FakeEditorOptions(), { fileWatcher });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));
        child.receiveFromHostPeer({
            kind: "notif",
            method: "workspace.watcher.create",
            params: { id: 1, base: "/repo", pattern: "**" },
        });
        await waitUntil(() => watched.length > 0);
        expect(disposed).toEqual([]);

        child.simulateExit(1);

        expect(disposed).toEqual(["/repo"]);
        host.dispose();
    });

    it("activation interrupted by death is not lost: the extension comes up on the next event", async () => {
        const child = new FakeChild();
        child.autoRespond = false;
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { logger });
        host.registerExtension(makeReg("ext.a", "/a.js"));
        const hanging = host.activateByEvent("*");
        await waitUntil(() => activated(child, "ext.a"));

        child.simulateExit(1);
        await hanging;

        expect(host.hasExtension("ext.a")).toBe(false);
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
            'activation of "ext.a" interrupted by extension host death — will retry',
        );
        const next = armNextChild();
        await host.activateByEvent("onLanguage:python");

        expect(activated(next, "ext.a")).toBe(true);
        expect(host.hasExtension("ext.a")).toBe(true);
        host.dispose();
    });

    it("an extension removed during the interrupted activation is not revived, its sibling is (even without a logger)", async () => {
        const child = new FakeChild();
        child.autoRespond = false;
        const host = spawnReadyHost(child, new FakeEditorOptions());
        const registration = host.registerExtension(makeReg("ext.a", "/a.js"));
        host.registerExtension(makeReg("ext.b", "/b.js"));
        const hanging = host.activateByEvent("*");
        await waitUntil(() => activated(child, "ext.a") && activated(child, "ext.b"));

        registration.dispose();
        child.simulateExit(1);
        await hanging;

        const next = armNextChild();
        await host.activateByEvent("*");

        expect(activated(next, "ext.a")).toBe(false);
        expect(activated(next, "ext.b")).toBe(true);
        host.dispose();
    });

    it("a dead subprocess deactivates extensions, and the next event of ANY kind brings them back", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { logger });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));
        expect(host.hasExtension("ext.a")).toBe(true);

        child.simulateExit(1);

        expect(logger.warn).toHaveBeenCalledWith(DEATH_WARNING);
        expect(host.hasExtension("ext.a")).toBe(false);

        // An event NOT among the extension's activationEvents (those are `*`): its own event
        // fired long ago, and without a revive the extension would never come back.
        const next = armNextChild();
        await host.activateByEvent("onLanguage:python");

        expect(activated(next, "ext.a")).toBe(true);
        expect(host.hasExtension("ext.a")).toBe(true);
    });

    it("graceful shutdown does not count as death", async () => {
        const child = new FakeChild();
        child.exitOnSignal = "SIGTERM";
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { logger });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        host.dispose();
        await waitUntil(() => child.signals.length > 0);

        expect(logger.warn).not.toHaveBeenCalledWith(DEATH_WARNING);
    });

    it("a registration removed before revival is not brought back", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        const registration = await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.simulateExit(1);
        registration.dispose();

        const next = armNextChild();
        await host.activateByEvent("*");

        expect(activated(next, "ext.a")).toBe(false);
    });

    it("a removed extension is not revived after death", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        await host.unregisterExtension("ext.a");
        child.simulateExit(1);

        const next = armNextChild();
        await host.activateByEvent("*");

        expect(activated(next, "ext.a")).toBe(false);
    });

    it("an extension removed between two deaths is not revived either", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        const a = await registerAndActivate(host, makeReg("ext.a", "/a.js"));
        // The second extension keeps the host alive: without it there would be nothing to revive
        // and no source of a second death.
        host.registerExtension(makeReg("ext.b", "/b.js"));
        await host.activateByEvent("*");

        child.simulateExit(1);
        a.dispose();

        const second = armNextChild();
        await host.activateByEvent("*");
        expect(activated(second, "ext.b")).toBe(true);

        second.simulateExit(1);
        const third = armNextChild();
        await host.activateByEvent("*");

        expect(activated(third, "ext.b")).toBe(true);
        expect(activated(third, "ext.a")).toBe(false);
    });

    it("a shut-down host does not revive extensions", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.simulateExit(1);
        host.dispose();

        spawnMock.mockClear();
        await host.activateByEvent("*");

        expect(spawnMock).not.toHaveBeenCalled();
    });

    it("proxy commands of the dead process are replaced by activator stubs: the command does not disappear", async () => {
        const child = new FakeChild();
        const commands = new FakeCommandService();
        const host = spawnReadyHost(child, new FakeEditorOptions(), {}, commands);
        // The implicit `onCommand:` is computed when the registration is built; here `testRegistration` provides it.
        host.registerExtension(
            testRegistration({ ...makeReg("ext.a", "/a.js"), commandTitles: { "ext.a.run": "Run" } }),
        );
        await host.activateByEvent("*");
        child.receiveFromHostPeer({ kind: "notif", method: "commands.registerCommand", params: { id: "ext.a.run" } });
        const beforeDeath = commands.proxies.length;

        child.simulateExit(1);

        // The dead extension's proxy is removed, but a live entry is back in its place: otherwise
        // the command would vanish from the command palette along with the only way
        // to revive the extension by hand.
        expect(commands.proxies.filter((proxy) => !proxy.disposed)).toHaveLength(1);
        expect(commands.proxies.length).toBeGreaterThan(beforeDeath);
        expect(commands.proxies.at(-1)?.id).toBe("ext.a.run");

        const next = armNextChild();
        await commands.proxies.at(-1)?.invoke([]);
        expect(activated(next, "ext.a")).toBe(true);
    });

    it("a workspaceContains pass also revives: it is an activation event like any other", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            logger,
            configuration: makeConfigProvider().provider,
            // No workspaceContains candidates, so the scan never starts, yet
            // the revive must happen anyway.
            workspaceScanner: { exists: () => Promise.resolve(false), readDirectory: () => Promise.resolve([]) },
        });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.simulateExit(1);

        const next = armNextChild();
        await host.activateByWorkspaceContains();

        expect(activated(next, "ext.a")).toBe(true);
        expect(host.hasExtension("ext.a")).toBe(true);
        // The revived extension's reason is the scan itself, not someone's pattern: its own event
        // fired long ago.
        expect(logger.info).toHaveBeenCalledWith('activated extension "ext.a" (workspaceContains)');
    });

    it("without subprocess death an event does not start a folder pass, neither the first nor later ones", async () => {
        const child = new FakeChild();
        let scans = 0;
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            configuration: makeConfigProvider().provider,
            workspaceScanner: {
                exists: () => {
                    scans++;
                    // A match would make the scan start the extension.
                    return Promise.resolve(true);
                },
                readDirectory: () => Promise.resolve([]),
            },
        });
        host.registerExtension({ ...makeReg("ext.java", "/j.js"), activationEvents: ["workspaceContains:pom.xml"] });
        host.registerExtension(makeReg("ext.a", "/a.js"));

        await host.activateByEvent("*");
        await host.activateByEvent("onLanguage:markdown");

        expect(scans).toBe(0);
        expect(host.hasExtension("ext.a")).toBe(true);
        expect(host.hasExtension("ext.java")).toBe(false);
        host.dispose();
    });

    it("an event waits only for in-flight activation of its own extensions, not others'", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        host.registerExtension({ ...makeReg("ext.slow", "/s.js"), activationEvents: ["onLanguage:java"] });
        child.autoRespond = false;
        void host.activateByEvent("onLanguage:java");
        await waitUntil(() => activated(child, "ext.slow"));

        await expect(host.activateByEvent("onLanguage:markdown")).resolves.toBeUndefined();
        host.dispose();
    });

    it("an extension activated by a workspaceContains pass revives on any event: the journal replays along with the pass", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            configuration: makeConfigProvider().provider,
            workspaceScanner: {
                exists: (absolutePath: string) => Promise.resolve(absolutePath.endsWith("pom.xml")),
                readDirectory: () => Promise.resolve([]),
            },
        });
        host.registerExtension({ ...makeReg("ext.java", "/j.js"), activationEvents: ["workspaceContains:pom.xml"] });
        armNextChild();
        await host.activateByWorkspaceContains();
        expect(host.hasExtension("ext.java")).toBe(true);
        const first = spawnMock.mock.results.at(-1)?.value as FakeChild;

        first.simulateExit(1);
        const next = armNextChild();
        await host.activateByEvent("onLanguage:markdown");

        expect(activated(next, "ext.java")).toBe(true);
        expect(host.hasExtension("ext.java")).toBe(true);
        host.dispose();
    });

    it("an event before registration is not lost: the extension activates on registration itself", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await host.activateByEvent("onLanguage:python");
        // The subprocess starts only on registration, so the ready reply is wired to spawn.
        armNextChild();

        host.registerExtension({ ...makeReg("ext.py", "/py.js"), activationEvents: ["onLanguage:python"] });
        host.registerExtension({ ...makeReg("ext.go", "/go.js"), activationEvents: ["onLanguage:go"] });

        await waitUntil(() => host.hasExtension("ext.py"));
        expect(host.hasExtension("ext.go")).toBe(false);
        host.dispose();
    });

    it("activation on registration whose host failed to start is logged", async () => {
        const logger = makeLogger();
        const host = spawnReadyHost(new FakeChild(), new FakeEditorOptions(), { logger });
        await host.activateByEvent("onLanguage:python");
        spawnMock.mockImplementation(() => {
            throw new Error("spawn failed");
        });

        host.registerExtension({ ...makeReg("ext.py", "/py.js"), activationEvents: ["onLanguage:python"] });

        await waitUntil(() => logger.error.mock.calls.length > 0);
        expect(logger.error).toHaveBeenCalledWith(
            'failed to activate extension "ext.py" on registration',
            expect.anything(),
        );
        host.dispose();
    });

    it("a registration removed while the subprocess was starting is silently skipped by activation", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        const registration = host.registerExtension(makeReg("ext.a", "/a.js"));

        const activation = host.activateByEvent("*");
        registration.dispose();

        await expect(activation).resolves.toBeUndefined();
        expect(host.hasExtension("ext.a")).toBe(false);
        expect(activated(child, "ext.a")).toBe(false);
        host.dispose();
    });

    it("activateByEvent waits for an extension that another call is already activating", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        host.registerExtension(makeReg("ext.a", "/a.js"));
        child.autoRespond = false;

        const first = host.activateByEvent("*");
        await waitUntil(() => activated(child, "ext.a"));
        let secondDone = false;
        const second = host.activateByEvent("*").then(() => {
            secondDone = true;
        });
        // Let the promises settle fully (a macrotask, not a single microtask).
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(secondDone).toBe(false);

        const req = child.sent.find((m) => m.kind === "req" && m.method === "host.activateExtension");
        if (req?.kind === "req") child.receiveFromHostPeer({ kind: "res", id: req.id, result: null });
        await Promise.all([first, second]);
        expect(host.hasExtension("ext.a")).toBe(true);
    });

    it("nothing matches and nothing to revive: the subprocess is not started", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            configuration: makeConfigProvider().provider,
            workspaceScanner: { exists: () => Promise.resolve(false), readDirectory: () => Promise.resolve([]) },
        });
        host.registerExtension({
            ...makeReg("ext.a", "/a.js"),
            activationEvents: ["workspaceContains:pom.xml"],
        });

        spawnMock.mockClear();
        await host.activateByWorkspaceContains();

        expect(spawnMock).not.toHaveBeenCalled();
        expect(host.hasExtension("ext.a")).toBe(false);
        host.dispose();
    });
});

function makeSwitchableWorkspace(initial: string) {
    let folder = initial;
    const provider: IExtensionHostConfigProvider = {
        ...makeConfigProvider().provider,
        getWorkspaceFolders: () => [{ uri: folder, name: folder.slice(1), index: 0 }],
    };
    return {
        provider,
        switchTo: (next: string): void => {
            folder = next;
        },
    };
}

function initialFolders(child: FakeChild): unknown {
    const init = child.sent.find((m) => m.kind === "notif" && m.method === "workspace.initialize");
    return (init as { params: { workspaceFolders: unknown } } | undefined)?.params.workspaceFolders;
}

describe("ExtensionHost — window workspace change", () => {
    it("a live subprocess restarts: the old one exits, the new one sees the new folders and activates the active extensions", async () => {
        const child = new FakeChild();
        child.exitOnShutdown = true;
        const logger = makeLogger();
        const workspace = makeSwitchableWorkspace("/old");
        const host = spawnReadyHost(child, new FakeEditorOptions(), { logger, configuration: workspace.provider });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));
        expect(initialFolders(child)).toEqual([{ uri: "/old", name: "old", index: 0 }]);

        workspace.switchTo("/new");
        const next = armNextChild();
        await host.restartForWorkspaceChange();

        expect(child.sent.some((m) => m.kind === "req" && m.method === "host.shutdown")).toBe(true);
        expect(initialFolders(next)).toEqual([{ uri: "/new", name: "new", index: 0 }]);
        expect(activated(next, "ext.a")).toBe(true);
        expect(host.hasExtension("ext.a")).toBe(true);
        expect(logger.info).toHaveBeenCalledWith("workspace changed — restarting extension host");
        expect(logger.info).toHaveBeenCalledWith('activated extension "ext.a" (workspaceChanged)');
        expect(logger.warn).not.toHaveBeenCalledWith(DEATH_WARNING);
        host.dispose();
    });

    it("an event during exit starts the new spawn right away, and the extension activates in it once", async () => {
        const child = new FakeChild();
        // The old subprocess does not exit on host.shutdown; shutdown drags on until the signal.
        child.exitOnSignal = "SIGTERM";
        const workspace = makeSwitchableWorkspace("/old");
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            configuration: workspace.provider,
            shutdownTimeoutMs: 50,
        });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        workspace.switchTo("/new");
        const next = armNextChild();
        const restart = host.restartForWorkspaceChange();
        await host.activateByEvent("onLanguage:java");

        expect(activated(next, "ext.a")).toBe(true);

        await restart;

        expect(child.signals).toEqual(["SIGTERM"]);
        expect(spawnMock).toHaveBeenCalledTimes(2);
        const activations = next.sent.filter((m) => m.kind === "req" && m.method === "host.activateExtension");
        expect(activations).toHaveLength(1);
        host.dispose();
    });

    it("without a subprocess there is nothing to restart: only a workspaceContains pass over the new folders", async () => {
        const scanned: string[] = [];
        const logger = makeLogger();
        const workspace = makeSwitchableWorkspace("/old");
        const host = new ExtensionHost(new FakeEditorOptions(), NULL_COMMAND_SERVICE, {
            spawnArgs,
            logger,
            configuration: workspace.provider,
            workspaceScanner: {
                exists: (filePath: string) => {
                    scanned.push(filePath);
                    return Promise.resolve(filePath.startsWith("/new"));
                },
                readDirectory: () => Promise.resolve([]),
            },
        });
        host.registerExtension({ ...makeReg("ext.java", "/j.js"), activationEvents: ["workspaceContains:pom.xml"] });

        workspace.switchTo("/new");
        const next = armNextChild();
        await host.restartForWorkspaceChange();

        expect(scanned).toEqual(["/new/pom.xml"]);
        expect(activated(next, "ext.java")).toBe(true);
        expect(spawnMock).toHaveBeenCalledTimes(1);
        expect(logger.info).not.toHaveBeenCalledWith("workspace changed — restarting extension host");
        expect(logger.info).toHaveBeenCalledWith('activated extension "ext.java" (workspaceContains:pom.xml)');
        host.dispose();
    });

    it("a shut-down host does not start the subprocess", async () => {
        const child = new FakeChild();
        child.exitOnShutdown = true;
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));
        await host.shutdown();

        spawnMock.mockClear();
        await host.restartForWorkspaceChange();

        expect(spawnMock).not.toHaveBeenCalled();
    });
});

describe("ExtensionHost — activation reason in the log", () => {
    it("the log names the event that activated the extension", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { logger });
        host.registerExtension({ ...makeReg("ext.a", "/a.js"), activationEvents: ["onLanguage:java"] });

        await host.activateByEvent("onLanguage:java");

        expect(logger.info).toHaveBeenCalledWith('activated extension "ext.a" (onLanguage:java)');
        host.dispose();
    });

    it("for workspaceContains the reason is the MATCHED pattern, not the declared list", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            logger,
            configuration: makeConfigProvider().provider,
            workspaceScanner: {
                exists: (absolutePath: string) => Promise.resolve(absolutePath.endsWith("build.gradle")),
                readDirectory: () => Promise.resolve([]),
            },
        });
        host.registerExtension({
            ...makeReg("ext.a", "/a.js"),
            activationEvents: ["workspaceContains:pom.xml", "workspaceContains:build.gradle"],
        });

        // The subprocess starts only once the scan finishes, so the ready reply is wired to spawn.
        armNextChild();
        await host.activateByWorkspaceContains();

        expect(logger.info).toHaveBeenCalledWith('activated extension "ext.a" (workspaceContains:build.gradle)');
        host.dispose();
    });

    it("scanner throws: the walk counts as INTERRUPTED and says so in the log", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            logger,
            configuration: makeConfigProvider().provider,
            workspaceScanner: {
                exists: () => Promise.reject(new Error("boom")),
                readDirectory: () => Promise.resolve([]),
            },
        });
        host.registerExtension({
            ...makeReg("ext.a", "/a.js"),
            activationEvents: ["workspaceContains:pom.xml"],
        });

        await host.activateByWorkspaceContains();

        expect(logger.error).toHaveBeenCalledWith('workspaceContains scan for "ext.a" failed', expect.anything());
        // A silently aborted scan would read as "nothing matched", but these
        // are different things, and only this line tells them apart.
        expect(logger.warn).toHaveBeenCalledWith('workspaceContains scan for "ext.a" was cut short', {
            paths: ["pom.xml"],
            globs: [],
        });
        expect(host.hasExtension("ext.a")).toBe(false);
        host.dispose();
    });

    it("walk completes: NO interruption warning", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            logger,
            configuration: makeConfigProvider().provider,
            workspaceScanner: { exists: () => Promise.resolve(false), readDirectory: () => Promise.resolve([]) },
        });
        host.registerExtension({
            ...makeReg("ext.a", "/a.js"),
            activationEvents: ["workspaceContains:pom.xml"],
        });

        await host.activateByWorkspaceContains();

        expect(logger.warn).not.toHaveBeenCalled();
        host.dispose();
    });

    it("without a configuration provider there are no workspace folders: the walk does not start", async () => {
        const child = new FakeChild();
        const readDirectory = vi.fn(() => Promise.resolve([]));
        const exists = vi.fn(() => Promise.resolve(true));
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            workspaceScanner: { exists, readDirectory },
        });
        host.registerExtension({
            ...makeReg("ext.a", "/a.js"),
            activationEvents: ["workspaceContains:pom.xml", "workspaceContains:*/pom.xml"],
        });

        await host.activateByWorkspaceContains();

        expect(exists).not.toHaveBeenCalled();
        expect(readDirectory).not.toHaveBeenCalled();
        expect(host.hasExtension("ext.a")).toBe(false);
        host.dispose();
    });

    it("a HUNG walk is cut off by a timeout instead of waiting on the FS forever", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            logger,
            configuration: makeConfigProvider().provider,
            // A `readDirectory` that NEVER answers (network FS, detached
            // volume): the cancellation flag is not enough, it is only checked between directories.
            workspaceContainsTimeoutMs: 1,
            workspaceScanner: {
                exists: () => Promise.resolve(false),
                readDirectory: () => new Promise(() => undefined),
            },
        });
        host.registerExtension({
            ...makeReg("ext.a", "/a.js"),
            activationEvents: ["workspaceContains:*/pom.xml"],
        });

        await host.activateByWorkspaceContains();

        expect(logger.warn).toHaveBeenCalledWith('workspaceContains scan for "ext.a" was cut short', {
            paths: [],
            globs: ["*/pom.xml"],
        });
        expect(host.hasExtension("ext.a")).toBe(false);
        host.dispose();
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

    it("leaves alone a subprocess that died before shutdown: no host.shutdown, no signals", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.simulateExit(0);
        host.dispose();
        await new Promise((r) => setTimeout(r, 20));

        expect(child.sent.some((m) => m.kind === "req" && m.method === "host.shutdown")).toBe(false);
        expect(child.signals).toEqual([]);
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

    it("waits 60 s for host.ready by default, like upstream, instead of giving up on a slow start", async () => {
        vi.useFakeTimers();
        try {
            const child = new FakeChild();
            spawnMock.mockReturnValue(child as never); // ready never arrives
            const host = new ExtensionHost(new FakeEditorOptions(), NULL_COMMAND_SERVICE, { spawnArgs });
            host.registerExtension(makeReg("ext.a", "/a.js"));
            let settled = false;
            const activation = host.activateByEvent("*").finally(() => {
                settled = true;
            });
            activation.catch(() => undefined);

            await vi.advanceTimersByTimeAsync(59_999);
            expect(settled).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            await expect(activation).rejects.toThrow("did not become ready in 60000ms");
            host.dispose();
        } finally {
            vi.useRealTimers();
        }
    });

    it("command activator stub does not reject when the subprocess fails to start", async () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never); // ready never arrives
        const logger = makeLogger();
        const commands = new FakeCommandService();
        const host = new ExtensionHost(new FakeEditorOptions(), commands, {
            spawnArgs,
            logger,
            readyTimeoutMs: 20,
        });
        host.registerExtension({ ...makeReg("ext.a", "/a.js"), activationEvents: ["onCommand:ext.a.run"] });

        // Commands run fire-and-forget (command palette, keybinding): a reject would end up in
        // the main process's unhandledRejection instead of anyone's hands.
        await expect(commands.proxies.at(-1)?.invoke([])).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalledWith(
            'failed to activate extension for command "ext.a.run"',
            expect.anything(),
        );
        host.dispose();
    });

    it("extension activated but did not register the command: the log says exactly that", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const commands = new FakeCommandService();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { logger }, commands);
        host.registerExtension({ ...makeReg("ext.a", "/a.js"), activationEvents: ["onCommand:ext.a.run"] });

        await expect(commands.proxies.at(-1)?.invoke([])).resolves.toBeUndefined();

        expect(host.hasExtension("ext.a")).toBe(true);
        expect(logger.warn).toHaveBeenCalledWith('command "ext.a.run" is still unregistered after activation');
        host.dispose();
    });

    it("stub does not reject WITHOUT a logger either: swallowing the failure is not the logger's job", async () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never); // ready never arrives
        const commands = new FakeCommandService();
        const host = new ExtensionHost(new FakeEditorOptions(), commands, { spawnArgs, readyTimeoutMs: 20 });
        host.registerExtension({ ...makeReg("ext.a", "/a.js"), activationEvents: ["onCommand:ext.a.run"] });

        await expect(commands.proxies.at(-1)?.invoke([])).resolves.toBeUndefined();
        host.dispose();
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
        expect(child.signals).toEqual([]);
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

    it("escalates to SIGKILL when the subprocess ignores both shutdown and SIGTERM", async () => {
        const child = new FakeChild();
        child.exitOnSignal = "SIGKILL";
        const host = spawnReadyHost(child, new FakeEditorOptions(), { shutdownTimeoutMs: 10 });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        host.dispose();

        await waitUntil(() => child.signals.includes("SIGKILL"), 2000);
        expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
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
    const snapshot = { defaults: { editor: { tabSize: 4 } }, user: { editor: { tabSize: 2 } }, workspace: {} };
    const provider: IExtensionHostConfigProvider = {
        getSnapshot: () => snapshot,
        getWorkspaceFolders: () => [{ uri: "/repo", name: "repo", index: 0 }],
        getWorkspaceFile: () => undefined,
        onDidChange: (fn) => {
            cb = fn;
            return {
                dispose: (): void => {
                    cb = null;
                },
            };
        },
        updateValue: () => Promise.resolve(),
        getConfigurationScopes: () => new Map(),
    };
    return { provider, fire: (keys: readonly string[]) => cb?.(keys) };
}

describe("ExtensionHost — handshake seeds", () => {
    it("between ready and the first activation exactly these notifications go out, in exactly this order", async () => {
        const child = new FakeChild();
        const opened = { uri: Uri.file("/repo/a.ts").toString(), languageId: "typescript", version: 1, text: "a" };
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            configuration: makeConfigProvider().provider,
            openDocumentsProvider: () => [opened],
        });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        const firstActivation = child.sent.findIndex((m) => m.kind === "req" && m.method === "host.activateExtension");
        const seeds = child.sent
            .slice(0, firstActivation)
            .map((m) => (m.kind === "notif" ? m.method : `${m.kind}:${(m as { method?: string }).method ?? ""}`));
        // The order is a contract: the extension already reads configuration, the host environment
        // (`env.machineId`/`env.shell`), layout, active editor, theme,
        // catalog and open documents in activate().
        expect(seeds).toEqual([
            "workspace.initialize",
            "env.initialize",
            "editor.layoutChanged",
            "editor.activeEditorChanged",
            "window.themeChanged",
            "extensions.catalog",
            "editor.didOpen",
        ]);
        host.dispose();
    });

    it("with a terminal sink the seed ends with a terminal snapshot: all instances, then the active one", async () => {
        // bazel-java looks for its log in `window.terminals` in `activate()`: the snapshot
        // must land before the first activation, otherwise it creates a duplicate.
        const child = new FakeChild();
        const terminal = { id: 4, name: "bash", pid: 10, launch: { shellPath: "/bin/bash" } };
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            terminalSink: {
                snapshot: () => ({ terminals: [terminal], activeId: 4 }),
                subscribe: () => ({ dispose: () => undefined }),
                create: () => undefined,
                show: () => undefined,
                hide: () => undefined,
                sendText: () => undefined,
                dispose: () => undefined,
                reset: () => undefined,
            },
        });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        const firstActivation = child.sent.findIndex((m) => m.kind === "req" && m.method === "host.activateExtension");
        const seeds = child.sent.slice(0, firstActivation).filter((m) => m.kind === "notif");
        expect(seeds.slice(-2)).toEqual([
            { kind: "notif", method: "terminal.opened", params: terminal },
            { kind: "notif", method: "terminal.activeChanged", params: { id: 4 } },
        ]);
        host.dispose();
    });
});

describe("ExtensionHost — task wire (taskSink)", () => {
    it("core task events go to the subprocess as tasks.*; subprocess provider registration goes to the sink; death removes it", async () => {
        const child = new FakeChild();
        let events: IExtensionTaskEvents | null = null;
        const unregistered = vi.fn();
        const registered: string[] = [];
        const execution = { id: "x", task: { name: "t" } } as unknown as IWireTaskExecution;
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            taskSink: {
                subscribe: (e: IExtensionTaskEvents) => {
                    events = e;
                    return { dispose: () => undefined };
                },
                registerProvider: (extensionId: string, type: string) => {
                    registered.push(`${extensionId}:${type}`);
                    return { dispose: unregistered };
                },
                fetch: () => Promise.resolve([]),
                execute: () => Promise.reject(new Error("no")),
                terminate: () => undefined,
            },
        });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));
        const sink = events as IExtensionTaskEvents | null;
        if (sink === null) throw new Error("no subscription");
        sink.started(execution, 3, { type: "t" });
        sink.processStarted("x", 42);
        sink.processEnded("x", 1);
        sink.processEnded("x", undefined);
        sink.ended(execution);
        const tasks = child.sent.filter((m) => m.kind === "notif" && m.method.startsWith("tasks."));
        expect(tasks).toEqual([
            {
                kind: "notif",
                method: "tasks.didStart",
                params: { execution, terminalId: 3, resolvedDefinition: { type: "t" } },
            },
            { kind: "notif", method: "tasks.didStartProcess", params: { id: "x", processId: 42 } },
            { kind: "notif", method: "tasks.didEndProcess", params: { id: "x", exitCode: 1 } },
            { kind: "notif", method: "tasks.didEndProcess", params: { id: "x" } },
            { kind: "notif", method: "tasks.didEnd", params: { execution } },
        ]);
        child.receiveFromHostPeer({
            kind: "notif",
            method: "tasks.registerProvider",
            params: { handle: 0, type: "demo", extensionId: "ext.a" },
        });
        expect(registered).toEqual(["ext.a:demo"]);
        child.simulateExit(1);
        expect(unregistered).toHaveBeenCalledTimes(1);
        host.dispose();
    });
});

describe("ExtensionHost — WP3 config/window bridge", () => {
    it("pushes workspace.initialize after ready and re-pushes on config change", async () => {
        const child = new FakeChild();
        const cfg = makeConfigProvider();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { configuration: cfg.provider });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        const init = child.sent.find((m) => m.kind === "notif" && m.method === "workspace.initialize");
        expect(init).toBeDefined();
        expect((init as { params: unknown }).params).toEqual({
            configuration: { defaults: { editor: { tabSize: 4 } }, user: { editor: { tabSize: 2 } }, workspace: {} },
            workspaceFolders: [{ uri: "/repo", name: "repo", index: 0 }],
        });

        cfg.fire(["editor.tabSize"]);
        const changed = child.sent.filter((m) => m.kind === "notif" && m.method === "workspace.configurationChanged");
        expect(changed.at(-1)).toMatchObject({
            params: {
                configuration: {
                    defaults: { editor: { tabSize: 4 } },
                    user: { editor: { tabSize: 2 } },
                    workspace: {},
                },
                affectedKeys: ["editor.tabSize"],
            },
        });

        host.dispose();
    });

    it("mirrors window.showMessage to the logger by severity: history stays after the toast is gone", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { logger });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        let nextId = 700;
        const send = (severity: string, message: unknown): number => {
            const id = nextId++;
            child.receiveFromHostPeer({
                kind: "req",
                id,
                method: "window.showMessage",
                params: { severity, message },
            });
            return id;
        };
        send("error", "boom");
        send("warn", "careful");
        const last = send("info", "fyi");

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === last));
        expect(logger.error).toHaveBeenCalledWith("[extension] boom");
        expect(logger.warn).toHaveBeenCalledWith("[extension] careful");
        expect(logger.info).toHaveBeenCalledWith("[extension] fyi");

        host.dispose();
    });

    it("showing without a logger does not crash the handler: the message still reaches the sink", async () => {
        const child = new FakeChild();
        const shown: string[] = [];
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            notificationSink: {
                showMessage: (request: { message: string }) => {
                    shown.push(request.message);
                    return Promise.resolve(undefined);
                },
                cancel: () => undefined,
            },
        });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        for (const [id, severity] of [
            [790, "error"],
            [791, "warn"],
            [792, "info"],
        ] as const) {
            child.receiveFromHostPeer({
                kind: "req",
                id,
                method: "window.showMessage",
                params: { severity, message: `msg-${severity}` },
            });
        }

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 792));
        expect(shown).toEqual(["msg-error", "msg-warn", "msg-info"]);

        host.dispose();
    });

    it("without a message sink the extension gets a no-choice dismissal instead of hanging", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.receiveFromHostPeer({
            kind: "req",
            id: 710,
            method: "window.showMessage",
            params: { severity: "info", message: "hi", items: [{ title: "One" }] },
        });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 710));
        expect(child.sent.find((m) => m.kind === "res" && m.id === 710)).toMatchObject({ result: { index: null } });

        host.dispose();
    });

    it("garbage show params get the same no-choice answer", async () => {
        const child = new FakeChild();
        const shown: unknown[] = [];
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            notificationSink: {
                showMessage: (request: unknown) => {
                    shown.push(request);
                    return Promise.resolve(undefined);
                },
                cancel: () => undefined,
            },
        });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.receiveFromHostPeer({ kind: "req", id: 711, method: "window.showMessage", params: 42 });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 711));
        expect(child.sent.find((m) => m.kind === "res" && m.id === 711)).toMatchObject({ result: { index: null } });
        expect(shown).toEqual([]);

        host.dispose();
    });

    it("sink returns the clicked button index, the host mints the show handle", async () => {
        const child = new FakeChild();
        const handles: number[] = [];
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            notificationSink: {
                showMessage: (request: { handle: number }) => {
                    handles.push(request.handle);
                    return Promise.resolve(1);
                },
                cancel: () => undefined,
            },
        });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        for (const id of [720, 721]) {
            child.receiveFromHostPeer({
                kind: "req",
                id,
                method: "window.showMessage",
                params: { severity: "info", message: "hi", items: [{ title: "A" }, { title: "B" }] },
            });
        }

        await waitUntil(
            () => child.sent.filter((m) => m.kind === "res" && (m.id === 720 || m.id === 721)).length === 2,
        );
        expect(child.sent.find((m) => m.kind === "res" && m.id === 720)).toMatchObject({ result: { index: 1 } });
        // The addresses differ: the host uses them to dismiss a dead subprocess's shown messages.
        expect(new Set(handles).size).toBe(2);

        host.dispose();
    });

    it("a surface failure does not reject the extension request (otherwise the whole subprocess crashes)", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            logger,
            notificationSink: {
                showMessage: () => Promise.reject(new Error("widget exploded")),
                cancel: () => undefined,
            },
        });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.receiveFromHostPeer({
            kind: "req",
            id: 730,
            method: "window.showMessage",
            params: { severity: "info", message: "hi" },
        });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 730));
        const res = child.sent.find((m) => m.kind === "res" && m.id === 730);
        expect(res).toMatchObject({ result: { index: null } });
        expect(res).not.toHaveProperty("error");
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("widget exploded"));

        host.dispose();
    });

    it("a surface failure WITHOUT a logger does not reject the request either", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            notificationSink: {
                showMessage: () => Promise.reject(new Error("widget exploded")),
                cancel: () => undefined,
            },
        });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.receiveFromHostPeer({
            kind: "req",
            id: 735,
            method: "window.showMessage",
            params: { severity: "info", message: "hi" },
        });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 735));
        const res = child.sent.find((m) => m.kind === "res" && m.id === 735);
        expect(res).toMatchObject({ result: { index: null } });
        expect(res).not.toHaveProperty("error");

        host.dispose();
    });

    it("subprocess death dismisses its live messages: no one is left to answer them", async () => {
        const child = new FakeChild();
        const cancelled: number[] = [];
        let shownHandle = -1;
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            logger: makeLogger(),
            notificationSink: {
                showMessage: (request: { handle: number }) => {
                    shownHandle = request.handle;
                    // The message is live: the promise does not resolve until the user answers.
                    return new Promise<number | undefined>(() => undefined);
                },
                cancel: (handle: number) => cancelled.push(handle),
            },
        });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.receiveFromHostPeer({
            kind: "req",
            id: 740,
            method: "window.showMessage",
            params: { severity: "info", message: "hi", items: [{ title: "One" }] },
        });
        await waitUntil(() => shownHandle > 0);

        child.simulateExit(1);

        expect(cancelled).toEqual([shownHandle]);
    });

    it("subprocess death does NOT dismiss already answered messages", async () => {
        // Otherwise the sink would get "dismiss" for a message shown long ago, and that
        // is not harmless: the address could already point at someone else's message.
        const child = new FakeChild();
        const cancelled: number[] = [];
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            logger: makeLogger(),
            notificationSink: {
                showMessage: () => Promise.resolve(0),
                cancel: (handle: number) => cancelled.push(handle),
            },
        });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.receiveFromHostPeer({
            kind: "req",
            id: 745,
            method: "window.showMessage",
            params: { severity: "info", message: "hi", items: [{ title: "One" }] },
        });
        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 745));

        child.simulateExit(1);

        expect(cancelled).toEqual([]);
    });

    it("env.clipboard: reads and writes the same buffer as core copy/paste", async () => {
        const child = new FakeChild();
        const written: string[] = [];
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            clipboard: {
                readText: () => Promise.resolve("from clipboard"),
                writeText: (text: string) => {
                    written.push(text);
                    return Promise.resolve();
                },
            },
        });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.receiveFromHostPeer({ kind: "req", id: 750, method: "env.clipboard.readText", params: {} });
        child.receiveFromHostPeer({
            kind: "req",
            id: 751,
            method: "env.clipboard.writeText",
            params: { text: "written" },
        });
        // A non-string does not overwrite the buffer: the extension sent something other than its type promises.
        child.receiveFromHostPeer({ kind: "req", id: 752, method: "env.clipboard.writeText", params: { text: 7 } });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 752));
        expect(child.sent.find((m) => m.kind === "res" && m.id === 750)).toMatchObject({
            result: { text: "from clipboard" },
        });
        expect(written).toEqual(["written"]);

        host.dispose();
    });

    it("env.clipboard without a buffer returns an empty string instead of throwing", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.receiveFromHostPeer({ kind: "req", id: 760, method: "env.clipboard.readText", params: {} });
        child.receiveFromHostPeer({ kind: "req", id: 761, method: "env.clipboard.writeText", params: { text: "x" } });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 761));
        expect(child.sent.find((m) => m.kind === "res" && m.id === 760)).toMatchObject({ result: { text: "" } });
        // A write without a buffer is not an error either: a refusal would reach the extension.
        expect(child.sent.find((m) => m.kind === "res" && m.id === 761)).not.toHaveProperty("error");

        host.dispose();
    });

    it("env.openExternal passes the link to the opener; empty and non-string uris are rejected", async () => {
        const child = new FakeChild();
        const opened: string[] = [];
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            externalOpener: {
                open: (url: string) => {
                    opened.push(url);
                    return Promise.resolve(true);
                },
            },
        });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.receiveFromHostPeer({
            kind: "req",
            id: 770,
            method: "env.openExternal",
            params: { uri: "https://example.com/a?b=1" },
        });
        child.receiveFromHostPeer({ kind: "req", id: 771, method: "env.openExternal", params: { uri: "" } });
        child.receiveFromHostPeer({ kind: "req", id: 772, method: "env.openExternal", params: { uri: 7 } });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 772));
        expect(child.sent.find((m) => m.kind === "res" && m.id === 770)).toMatchObject({ result: { opened: true } });
        expect(child.sent.find((m) => m.kind === "res" && m.id === 771)).toMatchObject({ result: { opened: false } });
        expect(child.sent.find((m) => m.kind === "res" && m.id === 772)).toMatchObject({ result: { opened: false } });
        expect(opened).toEqual(["https://example.com/a?b=1"]);

        host.dispose();
    });

    it("env.openExternal without an opener reports failure", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.receiveFromHostPeer({
            kind: "req",
            id: 780,
            method: "env.openExternal",
            params: { uri: "https://example.com" },
        });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 780));
        expect(child.sent.find((m) => m.kind === "res" && m.id === 780)).toMatchObject({ result: { opened: false } });

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

describe("ExtensionHost — memento.update on the wire", () => {
    it("a foreign request shape gets an error response, not a silent write", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.receiveFromHostPeer({ kind: "req", id: 300, method: "memento.update", params: { extensionId: "ext.a" } });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 300));
        const res = child.sent.find((m) => m.kind === "res" && m.id === 300);
        expect(res).toMatchObject({
            error: { $isError: true, name: "Error", message: "memento.update: malformed params" },
        });
        host.dispose();
    });
});
