import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import type { IWireDebugSession } from "./debugWireTypes.ts";
import { ExtHostDebugAdapter } from "./extHostDebugAdapter.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

const EXT = "test.dbg";
const FOLDER = "file:///ws";

/** An OS adapter that records what the core sent and lets the test answer. */
class FakeAdapter extends ExtHostDebugAdapter {
    public readonly sent: DebugProtocol.ProtocolMessage[] = [];
    public stopped = 0;
    public disposed = false;

    public constructor(
        public readonly descriptor: vscode.DebugAdapterDescriptor,
        public readonly debugType: string,
        private readonly startError?: Error,
    ) {
        super();
    }

    public startSession(): Promise<void> {
        return this.startError ? Promise.reject(this.startError) : Promise.resolve();
    }

    public sendMessage(message: DebugProtocol.ProtocolMessage): void {
        this.sent.push(message);
    }

    public stopSession(): Promise<void> {
        this.stopped++;
        return Promise.resolve();
    }

    public override dispose(): void {
        this.disposed = true;
        super.dispose();
    }

    public send(message: object): void {
        this.onMessageEmitter.fire(message as DebugProtocol.ProtocolMessage);
    }

    public fail(error: Error): void {
        this.onErrorEmitter.fire(error);
    }

    public exit(code: number | null): void {
        this.onExitEmitter.fire(code);
    }
}

function setup(options: { debuggers?: unknown[]; startError?: Error } = {}) {
    const stub = makeStubRpc();
    const adapters: FakeAdapter[] = [];
    const host = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk(), (descriptor, debugType) => {
        // A descriptor of no known kind: no adapter.
        if (Object.keys(descriptor).length === 0) return undefined;
        const adapter = new FakeAdapter(descriptor, debugType, options.startError);
        adapters.push(adapter);
        return adapter;
    });
    stub.fire("workspace.initialize", { workspaceFolders: [{ uri: FOLDER, name: "ws", index: 0 }] });
    stub.fire("extensions.catalog", {
        extensions: [
            {
                id: EXT,
                extensionPath: "/ext/dbg",
                packageJSON: {
                    contributes: {
                        debuggers: options.debuggers ?? [
                            { type: "t", label: "T" },
                            { type: "exe", label: "Exe", program: "./adapter" },
                            { type: "addition" },
                        ],
                    },
                },
            },
            { id: "other.ext", extensionPath: "/ext/other", packageJSON: {} },
        ],
    });
    const debug = host.namespace.debug;
    const as = <T>(id: string | undefined, fn: () => T): T => host.owner.runAs(id, fn);
    const session = (overrides: Partial<IWireDebugSession> = {}): IWireDebugSession => ({
        id: "s1",
        type: "t",
        name: "Launch",
        folder: FOLDER,
        configuration: { type: "t", name: "Launch", request: "launch" },
        ...overrides,
    });
    const start = (handle: number, dto = session()) => stub.callRequest("debug.startAdapter", { handle, session: dto });
    const accepted = (method: string) =>
        stub.notifies.filter((n) => n.method === method).map((n) => n.params as Record<string, unknown>);
    return { stub, debug, adapters, as, session, start, accepted, vscode: host.namespace };
}

function inline(vscodeApi: typeof vscode) {
    const emitter = new vscodeApi.EventEmitter<vscode.DebugProtocolMessage>();
    const received: unknown[] = [];
    const implementation = {
        onDidSendMessage: emitter.event,
        handleMessage: (message: vscode.DebugProtocolMessage) => received.push(message),
        dispose: vi.fn(),
    };
    return {
        emitter,
        received,
        implementation,
        descriptor: new vscodeApi.DebugAdapterInlineImplementation(implementation),
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("vscode.debug — debug adapters in the subprocess", () => {
    it("every catalog tells the core the types of the main debugger contributions", () => {
        const { accepted } = setup();
        expect(accepted("debug.registerDebugTypes")).toEqual([{ types: ["t", "exe"] }]);
    });

    describe("registerDebugAdapterDescriptorFactory", () => {
        const factory = { createDebugAdapterDescriptor: () => undefined };

        it("only the extension that defines the debugger (with a label) registers its factory, once per type", () => {
            const { debug, as } = setup();
            expect(() => as("other.ext", () => debug.registerDebugAdapterDescriptorFactory("t", factory))).toThrow(
                new Error(
                    "a DebugAdapterDescriptorFactory can only be registered from the extension that defines the 't' debugger.",
                ),
            );
            expect(() => as(EXT, () => debug.registerDebugAdapterDescriptorFactory("addition", factory))).toThrow(
                "defines the 'addition' debugger",
            );
            expect(() => as("not.in.catalog", () => debug.registerDebugAdapterDescriptorFactory("t", factory))).toThrow(
                "defines the 't' debugger",
            );

            const registration = as("TEST.DBG", () => debug.registerDebugAdapterDescriptorFactory("t", factory));
            expect(() => as(EXT, () => debug.registerDebugAdapterDescriptorFactory("t", factory))).toThrow(
                new Error("a DebugAdapterDescriptorFactory can only be registered once per a type."),
            );
            registration.dispose();
            const next = { createDebugAdapterDescriptor: () => undefined };
            expect(() => as(EXT, () => debug.registerDebugAdapterDescriptorFactory("t", next))).not.toThrow();
            // A second dispose of the old registration leaves the new factory in place.
            registration.dispose();
            expect(() => as(EXT, () => debug.registerDebugAdapterDescriptorFactory("t", factory))).toThrow(
                "once per a type",
            );
        });

        it("a caller the overlay does not know (no owner) cannot be checked and is not refused", () => {
            const { debug } = setup();
            const registration = debug.registerDebugAdapterDescriptorFactory("addition", {
                createDebugAdapterDescriptor: () => undefined,
            });
            expect(() =>
                debug.registerDebugAdapterDescriptorFactory("addition", {
                    createDebugAdapterDescriptor: () => undefined,
                }),
            ).toThrow("once per a type");
            registration.dispose();
        });

        it("no factory registers nothing: the type stays free for a real one", () => {
            const { debug, as } = setup();
            const none = debug.registerDebugAdapterDescriptorFactory("t", undefined as never);
            debug.registerDebugAdapterTrackerFactory("t", undefined as never).dispose();
            expect(() =>
                as(EXT, () =>
                    debug.registerDebugAdapterDescriptorFactory("t", { createDebugAdapterDescriptor: () => undefined }),
                ),
            ).not.toThrow();
            none.dispose();
            expect(() =>
                as(EXT, () =>
                    debug.registerDebugAdapterDescriptorFactory("t", { createDebugAdapterDescriptor: () => undefined }),
                ),
            ).toThrow("once per a type");
        });
    });

    describe("debug.startAdapter — upstream $startDASession", () => {
        it("the factory gets the session and the executable of package.json; an inline adapter talks both ways", async () => {
            const { debug, as, start, accepted, stub, vscode } = setup();
            const { emitter, received, implementation, descriptor } = inline(vscode);
            const createDebugAdapterDescriptor = vi.fn(() => descriptor);
            as(EXT, () => debug.registerDebugAdapterDescriptorFactory("t", { createDebugAdapterDescriptor }));

            await expect(start(1)).resolves.toBeNull();

            const [[session, executable]] = createDebugAdapterDescriptor.mock.calls as unknown as [
                vscode.DebugSession,
                vscode.DebugAdapterExecutable | undefined,
            ][];
            expect(session).toMatchObject({ id: "s1", type: "t", name: "Launch", parentSession: undefined });
            expect(session.configuration).toEqual({ type: "t", name: "Launch", request: "launch" });
            expect(session.workspaceFolder?.name).toBe("ws");
            expect(Object.isFrozen(session)).toBe(true);
            expect(executable).toBeUndefined();

            emitter.fire({ seq: 1, type: "event", event: "initialized" } as never);
            expect(accepted("debug.acceptAdapterMessage")).toEqual([
                { handle: 1, message: { seq: 1, type: "event", event: "initialized" } },
            ]);
            stub.fire("debug.sendAdapterMessage", {
                handle: 1,
                message: { seq: 2, type: "request", command: "threads" },
            });
            stub.fire("debug.sendAdapterMessage", { handle: 9, message: { seq: 3 } });
            expect(received).toEqual([{ seq: 2, type: "request", command: "threads" }]);

            await expect(stub.callRequest("debug.stopAdapter", { handle: 1 })).resolves.toBeNull();
            expect(implementation.dispose).toHaveBeenCalledTimes(1);
            await expect(stub.callRequest("debug.stopAdapter", { handle: 1 })).resolves.toBeNull();
            expect(implementation.dispose).toHaveBeenCalledTimes(1);
        });

        it("a session is one object per id; a child's parent is the parent's object; no folder — none", async () => {
            const { debug, as, start, session, vscode, stub } = setup();
            const sessions: vscode.DebugSession[] = [];
            as(EXT, () =>
                debug.registerDebugAdapterDescriptorFactory("t", {
                    createDebugAdapterDescriptor: (s) => {
                        sessions.push(s);
                        return inline(vscode).descriptor;
                    },
                }),
            );
            const { folder: _folder, ...withoutFolder } = session({ id: "child", parentId: "s1" });
            await start(1);
            await start(2, withoutFolder);
            await start(3);
            expect(sessions[1].parentSession).toBe(sessions[0]);
            expect(sessions[1].workspaceFolder).toBeUndefined();
            expect(sessions[2]).toBe(sessions[0]);
            // The adapter's stop keeps the session (upstream): it goes when the core says it terminated.
            await stub.callRequest("debug.stopAdapter", { handle: 1 });
            await start(4);
            expect(sessions[3]).toBe(sessions[0]);
            stub.fire("debug.acceptSessionTerminated", { session: session() });
            await start(5);
            expect(sessions[4]).not.toBe(sessions[0]);
            expect(sessions[4].id).toBe("s1");
        });

        it("`debugServer` in the configuration wins over the factory: a TCP adapter on that port", async () => {
            const { debug, as, start, adapters, session } = setup();
            const createDebugAdapterDescriptor = vi.fn();
            as(EXT, () => debug.registerDebugAdapterDescriptorFactory("t", { createDebugAdapterDescriptor }));
            await start(1, session({ configuration: { type: "t", name: "L", request: "launch", debugServer: 4711 } }));
            expect(createDebugAdapterDescriptor).not.toHaveBeenCalled();
            expect(adapters[0].descriptor).toEqual({ port: 4711 });
            expect(adapters[0].debugType).toBe("t");
        });

        it("without a factory the executable of contributes.debuggers; the factory gets it too", async () => {
            const { debug, as, start, adapters, session } = setup();
            await start(1, session({ type: "exe" }));
            expect(adapters[0].descriptor).toEqual({ command: "/ext/dbg/adapter", args: [], options: undefined });

            const createDebugAdapterDescriptor = vi.fn((_s: unknown, executable: unknown) => executable);
            as(EXT, () =>
                debug.registerDebugAdapterDescriptorFactory("exe", { createDebugAdapterDescriptor } as never),
            );
            await start(2, session({ id: "s2", type: "exe" }));
            expect(adapters[1].descriptor).toEqual({ command: "/ext/dbg/adapter", args: [], options: undefined });
        });

        it("no descriptor, or a descriptor no adapter is made for, fails the start with upstream's message", async () => {
            const { debug, as, start, vscode } = setup();
            const noDescriptor =
                "Couldn't find a debug adapter descriptor for debug type 't' (extension might have failed to activate)";
            await expect(start(1)).rejects.toThrow(noDescriptor);
            const nullFactory = as(EXT, () =>
                debug.registerDebugAdapterDescriptorFactory("t", { createDebugAdapterDescriptor: () => null }),
            );
            await expect(start(3)).rejects.toThrow(noDescriptor);
            nullFactory.dispose();
            as(EXT, () =>
                debug.registerDebugAdapterDescriptorFactory("t", {
                    createDebugAdapterDescriptor: () => ({}) as vscode.DebugAdapterDescriptor,
                }),
            );
            await expect(start(2)).rejects.toThrow("Couldn't create a debug adapter for type 't'.");
        });

        it("without the OS adapters (a namespace of the tests) only an inline adapter is made", async () => {
            const stub = makeStubRpc();
            const host = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());
            stub.fire("extensions.catalog", { extensions: [] });
            const dto = { id: "s", type: "t", name: "L", configuration: { debugServer: 4711 } };
            await expect(stub.callRequest("debug.startAdapter", { handle: 1, session: dto })).rejects.toThrow(
                "Couldn't create a debug adapter for type 't'.",
            );
            expect(host.namespace.debug).toBeDefined();
        });

        it("an adapter that fails to start fails the start", async () => {
            const { start, session } = setup({ startError: new Error("no such port") });
            await expect(start(1, session({ type: "exe" }))).rejects.toThrow("no such port");
        });

        it("errors and exits of the adapter go to the core with their handle", async () => {
            const { start, accepted, adapters, session } = setup();
            await start(7, session({ type: "exe" }));
            const error = new TypeError("boom");
            adapters[0].fail(error);
            const noStack = new Error("plain");
            noStack.stack = undefined;
            adapters[0].fail(noStack);
            adapters[0].exit(2);
            adapters[0].exit(null);
            expect(accepted("debug.acceptAdapterError")).toEqual([
                { handle: 7, error: { $isError: true, name: "TypeError", message: "boom", stack: error.stack } },
                { handle: 7, error: { $isError: true, name: "Error", message: "plain", stack: undefined } },
            ]);
            expect(accepted("debug.acceptAdapterExit")).toEqual([{ handle: 7, code: 2 }, { handle: 7 }]);
        });

        it("the `handshake` request is answered here, not passed to the core: there is no signer", async () => {
            const { start, accepted, adapters, session } = setup();
            await start(1, session({ type: "exe" }));
            adapters[0].send({ seq: 5, type: "request", command: "handshake", arguments: { value: "x" } });
            adapters[0].send({ seq: 6, type: "request", command: "runInTerminal" });
            // Only the adapter's request is the handshake; a response or event of that name goes to the core.
            adapters[0].send({ seq: 7, type: "response", command: "handshake", request_seq: 1, success: true });
            expect(adapters[0].sent).toEqual([
                {
                    type: "response",
                    seq: 0,
                    command: "handshake",
                    request_seq: 5,
                    success: false,
                    message: "no signer",
                },
            ]);
            expect(accepted("debug.acceptAdapterMessage").map((m) => (m.message as { seq: number }).seq)).toEqual([
                6, 7,
            ]);
        });
    });

    describe("trackers — upstream getDebugAdapterTrackers and MultiTracker", () => {
        function recordingTracker(name: string, log: string[]): vscode.DebugAdapterTracker {
            return {
                onWillStartSession: () => log.push(`${name}:start`),
                onWillReceiveMessage: (m: { seq: number }) => log.push(`${name}:> ${String(m.seq)}`),
                onDidSendMessage: (m: { seq: number }) => log.push(`${name}:< ${String(m.seq)}`),
                onWillStopSession: () => log.push(`${name}:stop`),
                onError: (e) => log.push(`${name}:error ${e.message}`),
                onExit: (code, signal) => log.push(`${name}:exit ${String(code)} ${String(signal)}`),
            };
        }

        it("the trackers of the type and of `*` see the session; others, failing and empty ones are skipped", async () => {
            const { debug, start, stub, adapters, session } = setup();
            const log: string[] = [];
            debug.registerDebugAdapterTrackerFactory("exe", {
                createDebugAdapterTracker: () => recordingTracker("a", log),
            });
            debug.registerDebugAdapterTrackerFactory("*", {
                createDebugAdapterTracker: () => Promise.resolve(recordingTracker("b", log)),
            });
            debug.registerDebugAdapterTrackerFactory("t", {
                createDebugAdapterTracker: () => recordingTracker("c", log),
            });
            debug.registerDebugAdapterTrackerFactory("*", {
                createDebugAdapterTracker: () => {
                    throw new Error("broken");
                },
            });
            debug.registerDebugAdapterTrackerFactory("*", { createDebugAdapterTracker: () => undefined });
            const removed = debug.registerDebugAdapterTrackerFactory("*", {
                createDebugAdapterTracker: () => recordingTracker("d", log),
            });
            removed.dispose();

            await start(1, session({ type: "exe" }));
            adapters[0].send({ seq: 1, type: "event", event: "initialized" });
            stub.fire("debug.sendAdapterMessage", {
                handle: 1,
                message: { seq: 2, type: "request", command: "threads" },
            });
            adapters[0].fail(new Error("oops"));
            adapters[0].exit(1);
            await stub.callRequest("debug.stopAdapter", { handle: 1 });

            expect(log).toEqual([
                "a:start",
                "b:start",
                "a:< 1",
                "b:< 1",
                "a:> 2",
                "b:> 2",
                "a:error oops",
                "b:error oops",
                "a:exit 1 undefined",
                "b:exit 1 undefined",
                "a:stop",
                "b:stop",
            ]);
            expect(adapters[0].stopped).toBe(1);
            // Not disposed: a process killed by the stop still reports its exit to the tracker, as upstream's.
            expect(adapters[0].disposed).toBe(false);
        });

        it("trackers missing methods are fine; an exit without a code reaches them as undefined", async () => {
            const { debug, start, adapters, stub, session } = setup();
            const onExit = vi.fn();
            debug.registerDebugAdapterTrackerFactory("*", { createDebugAdapterTracker: () => ({}) });
            debug.registerDebugAdapterTrackerFactory("*", { createDebugAdapterTracker: () => ({ onExit }) });
            await start(1, session({ type: "exe" }));
            adapters[0].send({ seq: 1, type: "event", event: "initialized" });
            stub.fire("debug.sendAdapterMessage", { handle: 1, message: { seq: 2 } });
            adapters[0].fail(new Error("x"));
            adapters[0].exit(null);
            await stub.callRequest("debug.stopAdapter", { handle: 1 });
            expect(onExit).toHaveBeenCalledWith(undefined, undefined);
        });

        it("tracker factories slower than a second are given up: the session runs and stops without trackers", async () => {
            vi.useFakeTimers();
            const { debug, start, adapters, session, accepted, stub } = setup();
            const onWillStartSession = vi.fn();
            debug.registerDebugAdapterTrackerFactory("*", {
                createDebugAdapterTracker: () =>
                    new Promise((resolve) => {
                        setTimeout(() => {
                            resolve({ onWillStartSession });
                        }, 5000);
                    }),
            });
            const started = start(1, session({ type: "exe" }));
            await vi.advanceTimersByTimeAsync(999);
            expect(adapters[0].stopped).toBe(0);
            let done = false;
            void started.then(() => (done = true));
            await vi.advanceTimersByTimeAsync(0);
            expect(done).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            expect(done).toBe(true);
            await vi.advanceTimersByTimeAsync(5000);
            expect(onWillStartSession).not.toHaveBeenCalled();

            adapters[0].send({ seq: 1, type: "event", event: "initialized" });
            stub.fire("debug.sendAdapterMessage", {
                handle: 1,
                message: { seq: 2, type: "request", command: "threads" },
            });
            adapters[0].fail(new Error("oops"));
            adapters[0].exit(0);
            expect(accepted("debug.acceptAdapterMessage")).toHaveLength(1);
            expect(adapters[0].sent).toEqual([{ seq: 2, type: "request", command: "threads" }]);
            expect(accepted("debug.acceptAdapterError")).toHaveLength(1);
            expect(accepted("debug.acceptAdapterExit")).toEqual([{ handle: 1, code: 0 }]);
            await expect(stub.callRequest("debug.stopAdapter", { handle: 1 })).resolves.toBeNull();
            expect(adapters[0].stopped).toBe(1);
        });
    });
});
