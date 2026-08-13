import { EventEmitter } from "node:events";
import type * as nodeModule from "node:module";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { IDisposable } from "@tuidom/all/common/disposable";
import { registerAndActivate } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { NULL_COMMAND_SERVICE } from "../../../api/common/iCommandService.ts";
import type {
    IActiveEditorMeta,
    IActiveEditorSelections,
    IEditorOptionsPatch,
    IEditorOptionsService,
    IEditorOptionsState,
} from "../../../api/common/iEditorOptionsService.ts";
import type { IProtocolMessage } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost } from "./extensionHost.ts";
import type { IExtensionRegistration } from "./iExtensionEntry.ts";

// `spawn` is mocked so no real subprocess is launched; `createRequire` is mocked so the
// SEA-detection branch in `defaultSpawnArgs` can be driven from the test.
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

// Mutable knob read by the mocked `createRequire` at call time.
const seaState: { mode: "real" | "isSea" | "throw" } = { mode: "real" };
vi.mock("node:module", async (importOriginal) => {
    const actual = await importOriginal<typeof nodeModule>();
    return Object.assign({}, actual, {
        createRequire: (specifier: string | URL) => {
            const realRequire = actual.createRequire(specifier);
            return ((id: string): unknown => {
                if (id === "node:sea") {
                    if (seaState.mode === "throw") throw new Error("node:sea unavailable");
                    return { isSea: (): boolean => seaState.mode === "isSea" };
                }
                return realRequire(id);
            }) as NodeJS.Require;
        },
    });
});

const { spawn } = await import("node:child_process");
const spawnMock = vi.mocked(spawn);

/** Minimal in-memory ChildProcess speaking the RPC envelope, with controllable kill behaviour. */
class FakeChild extends EventEmitter {
    public exitCode: number | null = null;
    public killed = false;
    public stdout = null;
    public stderr = null;
    public readonly sent: IProtocolMessage[] = [];
    public readonly signals: string[] = [];

    /** When false, a SIGTERM/SIGKILL does NOT flip `killed` — models a child that ignores signals. */
    public markKilled = true;
    /** When true, exit in response to this exact signal. */
    public exitOnSignal: string | null = null;
    /** When false, host→child requests get no reply (used to make shutdown hang). */
    public autoRespond = true;

    public send(message: IProtocolMessage): boolean {
        this.sent.push(message);
        // Auto-reply to every host→child request so `activateByEvent` (host.activateExtension)
        // resolves. `host.shutdown` is intentionally NOT answered: the shutdown path must fall
        // back to signals.
        if (message.kind === "req" && this.autoRespond && message.method !== "host.shutdown") {
            queueMicrotask(() => this.emit("message", { kind: "res", id: message.id, result: null }));
        }
        return true;
    }

    public kill(signal?: string): boolean {
        const sig = signal ?? "SIGTERM";
        this.signals.push(sig);
        if (this.markKilled) this.killed = true;
        if (this.exitOnSignal !== null && sig === this.exitOnSignal) {
            this.exitCode = 0;
            this.emit("exit", 0, sig);
        }
        return true;
    }

    public emitReady(): void {
        this.emit("message", { kind: "notif", method: "host.ready", params: undefined });
    }
}

class FakeEditorOptions implements IEditorOptionsService {
    public getActiveEditorOptions(): IEditorOptionsState | null {
        return { tabSize: 4, insertSpaces: true };
    }
    public setActiveEditorOptions(_patch: IEditorOptionsPatch): void {
        /* no-op */
    }
    public getActiveEditorFilePath(): string | null {
        return null;
    }
    public getActiveEditorMeta(): IActiveEditorMeta {
        return { uri: null, languageId: null, isDirty: false, encoding: null, eol: null, selection: null };
    }
    public onActiveEditorChanged(_cb: (meta: IActiveEditorMeta) => void): IDisposable {
        return { dispose: (): void => undefined };
    }
    public onActiveEditorSelectionChanged(_cb: (selections: IActiveEditorSelections) => void): IDisposable {
        return { dispose: (): void => undefined };
    }
    public setActiveEditorSelections(): void {}
    public applyActiveEditorEdits(): boolean {
        return false;
    }
}

function makeReg(id: string): IExtensionRegistration {
    return { id, manifest: { name: id, publisher: "test", version: "0.0.1" }, mainPath: "/main.js" };
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
function spawnReadyHost(child: FakeChild, options = {}): ExtensionHost {
    spawnMock.mockReturnValue(child as never);
    queueMicrotask(() => {
        child.emitReady();
    });
    return new ExtensionHost(new FakeEditorOptions(), NULL_COMMAND_SERVICE, options);
}

afterEach(() => {
    spawnMock.mockReset();
    seaState.mode = "real";
});

describe("ExtensionHost — SIGKILL escalation (lines 242-247)", () => {
    it("escalates to SIGKILL when the child ignores host.shutdown and survives SIGTERM", async () => {
        const child = new FakeChild();
        child.markKilled = false; // SIGTERM does not flip `killed`, so the second guard passes…
        child.exitOnSignal = "SIGKILL"; // …and SIGKILL finally takes it down (keeps the test fast).
        const host = spawnReadyHost(child, {
            spawnArgs: () => ({ command: "node", args: ["h.js"] }),
            shutdownTimeoutMs: 10,
        });
        await registerAndActivate(host, makeReg("ext.a"));

        host.dispose();

        await waitUntil(() => child.signals.includes("SIGKILL"));
        expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    });
});

describe("ExtensionHost — defaultSpawnArgs / detectIsSea (lines 268-290)", () => {
    it("derives command/args from process.execPath + main script when no spawnArgs is given", async () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        queueMicrotask(() => {
            child.emitReady();
        });
        const host = new ExtensionHost(new FakeEditorOptions(), NULL_COMMAND_SERVICE); // no spawnArgs → defaultSpawnArgs

        await registerAndActivate(host, makeReg("ext.a"));

        const [command, args] = spawnMock.mock.calls[0] as [string, string[], unknown];
        expect(command).toBe(process.execPath);
        expect(args).toContain(process.argv[1]); // dev path: appends the main script
        host.dispose();
        await waitUntil(() => true);
    });

    it("returns an empty arg list in SEA mode (sea.isSea() === true)", async () => {
        seaState.mode = "isSea";
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        queueMicrotask(() => {
            child.emitReady();
        });
        const host = new ExtensionHost(new FakeEditorOptions(), NULL_COMMAND_SERVICE);

        await registerAndActivate(host, makeReg("ext.a"));

        const [command, args] = spawnMock.mock.calls[0] as [string, string[], unknown];
        expect(command).toBe(process.execPath);
        expect(args).toEqual([]);
        host.dispose();
        await waitUntil(() => true);
    });

    it("treats a failing node:sea require as 'not SEA' (catch branch)", async () => {
        seaState.mode = "throw";
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        queueMicrotask(() => {
            child.emitReady();
        });
        const host = new ExtensionHost(new FakeEditorOptions(), NULL_COMMAND_SERVICE);

        await registerAndActivate(host, makeReg("ext.a"));

        // Falls through to the dev path (main script appended), proving the catch returned false.
        const [, args] = spawnMock.mock.calls[0] as [string, string[], unknown];
        expect(args).toContain(process.argv[1]);
        host.dispose();
        await waitUntil(() => true);
    });

    it("throws when the main script cannot be determined", async () => {
        const original = process.argv[1];
        process.argv[1] = ""; // simulate a missing main script
        try {
            const host = new ExtensionHost(new FakeEditorOptions(), NULL_COMMAND_SERVICE);
            host.registerExtension(makeReg("ext.a"));
            await expect(host.activateByEvent("*")).rejects.toThrow(/cannot determine main script/);
        } finally {
            process.argv[1] = original;
        }
    });
});
