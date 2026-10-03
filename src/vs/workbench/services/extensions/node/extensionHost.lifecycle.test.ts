import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { registerAndActivate } from "../../../../../TestUtils/ExtensionTestHarness.ts";
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
    public applyWorkspaceEdit(): boolean {
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
    // `isEnabled` — часть ILogger: без него логгер не подставить в типизированные
    // опции хоста (`spawnReadyHost` принимает их нетипизированным `options = {}`).
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

/**
 * Продюсер каталога `vscode.extensions`: что именно хост кладёт в провод.
 * Потребителя (`extensionsNamespace`) проверяют свои юниты, сквозняк —
 * `extensionHost.extensionsCatalog.test.ts` на живом субпроцессе; здесь — форма
 * сообщения, которую ни тот, ни другой не видят (разбор на той стороне
 * отбрасывает мусор и прячет лишнее в каталоге).
 */
describe("ExtensionHost — каталог расширений на проводе", () => {
    const catalogs = (child: FakeChild): { extensions: unknown[] }[] =>
        child.sent
            .filter((m) => m.kind === "notif" && m.method === "extensions.catalog")
            .map((m) => (m as { params: { extensions: unknown[] } }).params);

    it("семя на handshake несёт ровно зарегистрированные расширения с их манифестами", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        host.registerExtension({
            id: "ext.a",
            manifest: { name: "a", publisher: "ext", version: "1.2.3", displayName: "Первое" },
            mainPath: "/ext-a/out/main.js",
        });
        host.registerExtension(makeReg("ext.b", "/ext-b/main.js"));
        await host.activateByEvent("*");

        const [seed] = catalogs(child);
        expect(seed.extensions).toEqual([
            {
                id: "ext.a",
                extensionPath: "/ext-a/out",
                packageJSON: { name: "a", publisher: "ext", version: "1.2.3", displayName: "Первое" },
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

    it("активация едет точечным `extensions.activated`, а не новым каталогом", async () => {
        // Манифесты тяжёлые — гонять весь список ради одного флага нельзя.
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        host.registerExtension(makeReg("ext.a", "/a.js"));
        const before = catalogs(child).length;
        await host.activateByEvent("*");

        expect(catalogs(child).length).toBe(before + 1); // только семя на подъёме
        expect(child.sent.filter((m) => m.kind === "notif" && m.method === "extensions.activated")).toEqual([
            { kind: "notif", method: "extensions.activated", params: { id: "ext.a" } },
        ]);
        host.dispose();
    });

    it("снятие расширения пере-push'ит каталог уже без него", async () => {
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

    it("после смерти субпроцесса состав переезжает целиком, а активность честно обнуляется", async () => {
        // В новом субпроцессе в момент handshake не активен НИКТО — оживление
        // ещё впереди, и рапортовать `isActive: true` значило бы соврать
        // соседу, который читает каталог прямо в своём `activate()`. Флаг
        // возвращает уже `extensions.activated`, по одному на оживлённого.
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

    it("disposeNow снимает субпроцесс сигналом — синхронно, без ожидания прощания", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        host.disposeNow();

        // Перезагрузка окна дальше блокирует event loop: вежливое «попроси и
        // подожди» не доехало бы, и субпроцесс остался бы жить сиротой.
        expect(child.signals).toEqual(["SIGKILL"]);
        expect(child.killed).toBe(true);
    });

    it("shutdown ждёт вежливого выхода субпроцесса, а disposeNow после него никого не добивает", async () => {
        const child = new FakeChild();
        child.exitOnShutdown = true;
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        const done = host.shutdown();
        expect(host.shutdown()).toBe(done);
        await done;

        expect(child.sent.some((m) => m.kind === "req" && m.method === "host.shutdown")).toBe(true);
        expect(child.exitCode).toBe(0);
        // Синхронная фаза прощания зовёт disposeNow всегда — вышедшего по-хорошему он не трогает.
        host.disposeNow();
        expect(child.signals).toEqual([]);
    });

    it("disposeNow добивает субпроцесс, который ещё прощается после shutdown", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));
        // Субпроцесс завис в deactivate(): на host.shutdown не отвечает.
        child.autoRespond = false;

        void host.shutdown();
        host.disposeNow();

        expect(child.signals).toEqual(["SIGKILL"]);
    });

    it("расширения одного события активируются параллельно: соседи не ждут чужой activate()", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        host.registerExtension(makeReg("ext.slow", "/slow.js"));
        host.registerExtension(makeReg("ext.fast", "/fast.js"));
        child.autoRespond = false;

        const activation = host.activateByEvent("*");
        await waitUntil(
            () => child.sent.filter((m) => m.kind === "req" && m.method === "host.activateExtension").length === 2,
        );
        // Оба запроса ушли до первого ответа — второй не ждал первого.
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

    it("упавший activate() одного — в лог с id, сосед по событию активирован", async () => {
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
                    ? { kind: "res", id: req.id, error: { message: "boom" } }
                    : { kind: "res", id: req.id, result: null },
            );
        }
        await activation;

        expect(host.hasExtension("ext.bad")).toBe(false);
        expect(host.hasExtension("ext.good")).toBe(true);
        expect(logger.error).toHaveBeenCalledWith('failed to activate extension "ext.bad"', expect.anything());
    });

    it("disposeNow без поднятого субпроцесса просто гасит host", () => {
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

/**
 * Готовит следующий спавн: возвращённый ребёнок объявляет готовность сразу
 * после того, как хост подпишется на его сообщения.
 */
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

/** Активирован ли `id` в этом субпроцессе (по отправленному host.activateExtension). */
function activated(child: FakeChild, id: string): boolean {
    return child.sent.some(
        (m) => m.kind === "req" && m.method === "host.activateExtension" && (m.params as { id: string }).id === id,
    );
}

const DEATH_WARNING = "extension host subprocess died — resetting host state";

describe("ExtensionHost — смерть субпроцесса", () => {
    it("умерший субпроцесс гасит расширения, а следующее ЛЮБОЕ событие поднимает их заново", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { logger });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));
        expect(host.hasExtension("ext.a")).toBe(true);

        child.simulateExit(1);

        expect(logger.warn).toHaveBeenCalledWith(DEATH_WARNING);
        expect(host.hasExtension("ext.a")).toBe(false);

        // Событие НЕ из activationEvents расширения (там `*`): своё событие
        // давно отгорело, и без оживления расширение не вернулось бы никогда.
        const next = armNextChild();
        await host.activateByEvent("onLanguage:python");

        expect(activated(next, "ext.a")).toBe(true);
        expect(host.hasExtension("ext.a")).toBe(true);
    });

    it("вежливое выключение смертью не считается", async () => {
        const child = new FakeChild();
        child.exitOnSignal = "SIGTERM";
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { logger });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        host.dispose();
        await waitUntil(() => child.signals.length > 0);

        expect(logger.warn).not.toHaveBeenCalledWith(DEATH_WARNING);
    });

    it("снятая до оживления регистрация обратно не поднимается", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        const registration = await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.simulateExit(1);
        registration.dispose();

        const next = armNextChild();
        await host.activateByEvent("*");

        expect(activated(next, "ext.a")).toBe(false);
    });

    it("снятое расширение после смерти не воскресает", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        await host.unregisterExtension("ext.a");
        child.simulateExit(1);

        const next = armNextChild();
        await host.activateByEvent("*");

        expect(activated(next, "ext.a")).toBe(false);
    });

    it("не воскресает и то, что сняли между двумя смертями", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        const a = await registerAndActivate(host, makeReg("ext.a", "/a.js"));
        // Второе расширение держит хост живым: без него оживлять было бы нечего
        // и второй смерти неоткуда взяться.
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

    it("выключенный хост расширения не оживляет", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.simulateExit(1);
        host.dispose();

        spawnMock.mockClear();
        await host.activateByEvent("*");

        expect(spawnMock).not.toHaveBeenCalled();
    });

    it("прокси-команды мертвеца заменяются заглушками-активаторами: команда не исчезает", async () => {
        const child = new FakeChild();
        const commands = new FakeCommandService();
        const host = spawnReadyHost(child, new FakeEditorOptions(), {}, commands);
        host.registerExtension({ ...makeReg("ext.a", "/a.js"), commandTitles: { "ext.a.run": "Run" } });
        await host.activateByEvent("*");
        // Субпроцесс завёл настоящий прокси — заглушка снята.
        child.receiveFromHostPeer({ kind: "notif", method: "commands.registerCommand", params: { id: "ext.a.run" } });
        const beforeDeath = commands.proxies.length;

        child.simulateExit(1);

        // Прокси мертвеца снят, но на его месте снова живая запись: иначе
        // команда исчезла бы из палитры вместе с единственным способом
        // оживить расширение руками.
        expect(commands.proxies.filter((proxy) => !proxy.disposed)).toHaveLength(1);
        expect(commands.proxies.length).toBeGreaterThan(beforeDeath);
        expect(commands.proxies.at(-1)?.id).toBe("ext.a.run");

        // И заглушка правда оживляет: её исполнение поднимает новый субпроцесс.
        const next = armNextChild();
        await commands.proxies.at(-1)?.invoke([]);
        expect(activated(next, "ext.a")).toBe(true);
    });

    it("workspaceContains-проход тоже оживляет — это такое же событие активации", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            logger,
            configuration: makeConfigProvider().provider,
            // Кандидатов на workspaceContains нет — обход не начнётся, а
            // оживление обязано случиться всё равно.
            workspaceScanner: { exists: () => Promise.resolve(false), readDirectory: () => Promise.resolve([]) },
        });
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.simulateExit(1);

        const next = armNextChild();
        await host.activateByWorkspaceContains();

        expect(activated(next, "ext.a")).toBe(true);
        expect(host.hasExtension("ext.a")).toBe(true);
        // Повод у оживлённого — сам проход, а не чей-то паттерн: своё событие
        // у него давно отгорело.
        expect(logger.info).toHaveBeenCalledWith('activated extension "ext.a" (workspaceContains)');
    });

    it("поднятое проходом workspaceContains оживает на любом событии: журнал проигрывается вместе с проходом", async () => {
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
        // Событие ни при чём — повод у оживления свой: журнал + проход по ФС.
        await host.activateByEvent("onLanguage:markdown");

        expect(activated(next, "ext.java")).toBe(true);
        expect(host.hasExtension("ext.java")).toBe(true);
        host.dispose();
    });

    it("событие до регистрации не теряется: расширение встаёт на самой регистрации", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await host.activateByEvent("onLanguage:python");
        // Субпроцесс поднимется только на регистрации — ready-ответ вешаем на spawn.
        armNextChild();

        host.registerExtension({ ...makeReg("ext.py", "/py.js"), activationEvents: ["onLanguage:python"] });
        host.registerExtension({ ...makeReg("ext.go", "/go.js"), activationEvents: ["onLanguage:go"] });

        await waitUntil(() => host.hasExtension("ext.py"));
        expect(host.hasExtension("ext.go")).toBe(false);
        host.dispose();
    });

    it("активация на регистрации, у которой host не поднялся, пишется в лог", async () => {
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

    it("регистрацию сняли, пока поднимался субпроцесс, — активация тихо её пропускает", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        const registration = host.registerExtension(makeReg("ext.a", "/a.js"));

        const activation = host.activateByEvent("*");
        // Субпроцесс ещё не ответил ready — снимаем расширение из очереди.
        registration.dispose();

        await expect(activation).resolves.toBeUndefined();
        expect(host.hasExtension("ext.a")).toBe(false);
        expect(activated(child, "ext.a")).toBe(false);
        host.dispose();
    });

    it("activateByEvent дожидается расширения, которое уже поднимает другой вызов", async () => {
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
        await Promise.resolve();
        // Ответа на activateExtension ещё нет — второй вызов не врёт «готово».
        expect(secondDone).toBe(false);

        const req = child.sent.find((m) => m.kind === "req" && m.method === "host.activateExtension");
        if (req?.kind === "req") child.receiveFromHostPeer({ kind: "res", id: req.id, result: null });
        await Promise.all([first, second]);
        expect(host.hasExtension("ext.a")).toBe(true);
    });

    it("ничего не подошло и оживлять некого — субпроцесс не поднимается", async () => {
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

describe("ExtensionHost — причина активации в логе", () => {
    it("лог называет событие, поднявшее расширение", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { logger });
        host.registerExtension({ ...makeReg("ext.a", "/a.js"), activationEvents: ["onLanguage:java"] });

        await host.activateByEvent("onLanguage:java");

        expect(logger.info).toHaveBeenCalledWith('activated extension "ext.a" (onLanguage:java)');
        host.dispose();
    });

    it("у workspaceContains причина — ПОДОШЕДШИЙ паттерн, а не список объявленных", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            logger,
            configuration: makeConfigProvider().provider,
            // Папка воркспейса провайдера — `/repo`; сканер отвечает за неё.
            workspaceScanner: {
                exists: (absolutePath: string) => Promise.resolve(absolutePath.endsWith("build.gradle")),
                readDirectory: () => Promise.resolve([]),
            },
        });
        host.registerExtension({
            ...makeReg("ext.a", "/a.js"),
            activationEvents: ["workspaceContains:pom.xml", "workspaceContains:build.gradle"],
        });

        // Субпроцесс поднимется только по итогу обхода — ready-ответ вешаем на
        // сам spawn, а не на микротаск создания хоста.
        armNextChild();
        await host.activateByWorkspaceContains();

        expect(logger.info).toHaveBeenCalledWith('activated extension "ext.a" (workspaceContains:build.gradle)');
        host.dispose();
    });

    it("сканер бросил — обход считается ОБОРВАННЫМ и говорит об этом в лог", async () => {
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
        // Молча оборванный обход читался бы как «ничего не подошло» — а это
        // разные вещи, и отличить их можно только по этой строке.
        expect(logger.warn).toHaveBeenCalledWith('workspaceContains scan for "ext.a" was cut short', {
            paths: ["pom.xml"],
            globs: [],
        });
        expect(host.hasExtension("ext.a")).toBe(false);
        host.dispose();
    });

    it("обход дошёл до конца — предупреждения об обрыве НЕТ", async () => {
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

    it("без провайдера конфигурации папок воркспейса нет — обход не начинается", async () => {
        const child = new FakeChild();
        const readDirectory = vi.fn(() => Promise.resolve([]));
        const exists = vi.fn(() => Promise.resolve(true));
        // Хост без `configuration` — профиль/харнесс, где мост настроек не
        // подключён: папок воркспейса просто неоткуда взять.
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

    it("ПОВИСШИЙ обход обрывается тайм-аутом, а не ждёт ФС вечно", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            logger,
            configuration: makeConfigProvider().provider,
            // `readDirectory`, который не ответит НИКОГДА (сетевая ФС, отвалившийся
            // том): флага отмены тут мало — он смотрится между каталогами.
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

    it("не тревожит субпроцесс, умерший до выключения: ни host.shutdown, ни сигналов", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.simulateExit(0); // subprocess gone before we tear down
        // Смерть уже разобрана хостом (handleSubprocessDeath): ссылок на канал
        // нет, и выключению нечего и некому слать.
        host.dispose();
        await new Promise((r) => setTimeout(r, 20));

        expect(child.sent.some((m) => m.kind === "req" && m.method === "host.shutdown")).toBe(false);
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

    it("заглушка-активатор команды не отклоняется, когда субпроцесс не поднялся", async () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never); // ready не придёт никогда
        const logger = makeLogger();
        const commands = new FakeCommandService();
        const host = new ExtensionHost(new FakeEditorOptions(), commands, {
            spawnArgs,
            logger,
            readyTimeoutMs: 20,
        });
        host.registerExtension({ ...makeReg("ext.a", "/a.js"), activationEvents: ["onCommand:ext.a.run"] });

        // Команду исполняют fire-and-forget (палитра, бинд) — reject ушёл бы в
        // unhandledRejection главного процесса, а не кому-то в руки.
        await expect(commands.proxies.at(-1)?.invoke([])).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalledWith(
            'failed to activate extension for command "ext.a.run"',
            expect.anything(),
        );
        host.dispose();
    });

    it("расширение поднялось, но команду не завело — в логе сказано именно это", async () => {
        const child = new FakeChild();
        const logger = makeLogger();
        const commands = new FakeCommandService();
        const host = spawnReadyHost(child, new FakeEditorOptions(), { logger }, commands);
        // Субпроцесс отвечает на activateExtension, но `commands.registerCommand`
        // не присылает — ровно случай опечатки в манифесте или сбоя в activate().
        host.registerExtension({ ...makeReg("ext.a", "/a.js"), activationEvents: ["onCommand:ext.a.run"] });

        await expect(commands.proxies.at(-1)?.invoke([])).resolves.toBeUndefined();

        expect(host.hasExtension("ext.a")).toBe(true);
        expect(logger.warn).toHaveBeenCalledWith('command "ext.a.run" is still unregistered after activation');
        host.dispose();
    });

    it("заглушка не отклоняется и БЕЗ логгера: гасить провал — не работа логгера", async () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never); // ready не придёт никогда
        const commands = new FakeCommandService();
        // Логгера нет (профиль с NULL_LOG_SERVICE, харнессы): обращение к нему
        // в обработчике провала не должно превращать «вернул undefined» в reject.
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

    it("дублирует window.showMessage в логгер по строгости — история остаётся после того, как тост погас", async () => {
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

    it("показ без логгера не роняет обработчик: сообщение всё равно доходит до стока", async () => {
        const child = new FakeChild();
        const shown: string[] = [];
        // Логгера НЕТ (в этой сборке хост создан без него) — путь дублирования в
        // лог обязан это переживать, иначе показ отклонится целиком.
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

    it("без стока сообщений расширение получает «закрыто без выбора», а не висит", async () => {
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

    it("мусорные параметры показа — тот же ответ «без выбора»", async () => {
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

    it("сток отдаёт индекс нажатой кнопки, адрес показа минтит хост", async () => {
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
        // Адреса разные: по ним хост гасит показы умершего субпроцесса.
        expect(new Set(handles).size).toBe(2);

        host.dispose();
    });

    it("поломка поверхности не отклоняет запрос расширения (иначе падает весь субпроцесс)", async () => {
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

    it("поломка поверхности БЕЗ логгера тоже не отклоняет запрос", async () => {
        // Логгера нет, а сток кидает: путь дублирования в лог обязан это
        // переживать, иначе отказ доедет до расширения и уронит субпроцесс.
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

    it("смерть субпроцесса гасит его живые сообщения: отвечать на них стало некому", async () => {
        const child = new FakeChild();
        const cancelled: number[] = [];
        let shownHandle = -1;
        const host = spawnReadyHost(child, new FakeEditorOptions(), {
            logger: makeLogger(),
            notificationSink: {
                showMessage: (request: { handle: number }) => {
                    shownHandle = request.handle;
                    // Показ живой: обещание не резолвится до ответа человека.
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

    it("смерть субпроцесса НЕ гасит уже отвеченные сообщения", async () => {
        // Иначе сток получил бы «погаси» на показ, которого давно нет, — и это
        // не безвредно: адрес мог бы указывать уже на чужой показ.
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

    it("env.clipboard: читает и пишет тот же буфер, что copy/paste ядра", async () => {
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
        // Не-строка буфер не затирает: расширение прислало не то, что обещает тип.
        child.receiveFromHostPeer({ kind: "req", id: 752, method: "env.clipboard.writeText", params: { text: 7 } });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 752));
        expect(child.sent.find((m) => m.kind === "res" && m.id === 750)).toMatchObject({
            result: { text: "from clipboard" },
        });
        expect(written).toEqual(["written"]);

        host.dispose();
    });

    it("env.clipboard без буфера отдаёт пустую строку, а не падает", async () => {
        const child = new FakeChild();
        const host = spawnReadyHost(child, new FakeEditorOptions());
        await registerAndActivate(host, makeReg("ext.a", "/a.js"));

        child.receiveFromHostPeer({ kind: "req", id: 760, method: "env.clipboard.readText", params: {} });
        child.receiveFromHostPeer({ kind: "req", id: 761, method: "env.clipboard.writeText", params: { text: "x" } });

        await waitUntil(() => child.sent.some((m) => m.kind === "res" && m.id === 761));
        expect(child.sent.find((m) => m.kind === "res" && m.id === 760)).toMatchObject({ result: { text: "" } });
        // Запись без буфера — тоже не ошибка: отказ доехал бы до расширения.
        expect(child.sent.find((m) => m.kind === "res" && m.id === 761)).not.toHaveProperty("error");

        host.dispose();
    });

    it("env.openExternal отдаёт ссылку открывателю; пустой и не-строковый uri отсекаются", async () => {
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

    it("env.openExternal без открывателя честно отвечает «не удалось»", async () => {
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
