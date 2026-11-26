import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import type { IWireDebugSession } from "../../../api/common/debugWireTypes.ts";
import type {
    IExtensionDebugAdapterConnection,
    IExtensionDebugAdapterHost,
    IExtensionDebugAdapterListener,
} from "../../../api/common/iExtensionDebugSink.ts";
import type { IConfig, IDebugAdapterFactory, IDebugService, IDebugSession } from "../common/debug.ts";

import { ExtensionDebugAdapter, ExtensionHostDebugAdapter } from "./extensionDebugAdapter.ts";

const CONFIG: IConfig = { type: "lldb", request: "launch", name: "Launch" };

function fakeHost() {
    const created: { session: IWireDebugSession; listener: IExtensionDebugAdapterListener }[] = [];
    const connection = {
        start: vi.fn(() => Promise.resolve()),
        send: vi.fn(),
        stop: vi.fn(() => Promise.resolve()),
    } satisfies IExtensionDebugAdapterConnection;
    const host: IExtensionDebugAdapterHost = {
        createAdapter: (session, listener) => {
            created.push({ session, listener });
            return connection;
        },
    };
    return { host, created, connection };
}

function session(overrides: Partial<IDebugSession> = {}): IDebugSession {
    return {
        getId: () => "s1",
        name: "Launch (1)",
        configuration: CONFIG,
        root: undefined,
        parentSession: undefined,
        ...overrides,
    } as IDebugSession;
}

describe("ExtensionDebugAdapter.registerDebugTypes — upstream $registerDebugTypes", () => {
    it("the types get an adapter factory that makes adapters of the host; variables pass through unchanged", async () => {
        const registered: { types: string[]; factory: IDebugAdapterFactory; disposed: number }[] = [];
        const service = {
            getAdapterManager: () => ({
                registerDebugAdapterFactory: (types: string[], factory: IDebugAdapterFactory) => {
                    const entry = { types, factory, disposed: 0 };
                    registered.push(entry);
                    return {
                        dispose: () => {
                            entry.disposed++;
                        },
                    };
                },
            }),
        } as unknown as IDebugService;
        const { host, created } = fakeHost();

        const registration = new ExtensionDebugAdapter(() => service).registerDebugTypes(["lldb", "go"], host);

        expect(registered.map((r) => r.types)).toEqual([["lldb", "go"]]);
        const adapter = registered[0].factory.createDebugAdapter(session());
        expect(adapter).toBeInstanceOf(ExtensionHostDebugAdapter);
        expect(created).toHaveLength(1);
        await expect(registered[0].factory.substituteVariables(undefined, CONFIG)).resolves.toBe(CONFIG);
        registration.dispose();
        expect(registered[0].disposed).toBe(1);
    });
});

describe("ExtensionHostDebugAdapter — upstream's adapter over the extension host protocol", () => {
    it("the session goes to the subprocess as its id, type, name and configuration; folder and parent when there are", () => {
        const { host, created } = fakeHost();
        new ExtensionHostDebugAdapter(host, session()).dispose();
        new ExtensionHostDebugAdapter(
            host,
            session({
                getId: () => "child",
                root: { uri: Uri.file("/ws"), name: "ws", index: 0 },
                parentSession: session(),
            }),
        ).dispose();
        expect(created.map((c) => c.session)).toStrictEqual([
            { id: "s1", type: "lldb", name: "Launch (1)", configuration: CONFIG },
            {
                id: "child",
                type: "lldb",
                name: "Launch (1)",
                folder: "file:///ws",
                configuration: CONFIG,
                parentId: "s1",
            },
        ]);
    });

    it("start and send go to the connection; messages, errors and exits of the subprocess reach the session", async () => {
        const { host, created, connection } = fakeHost();
        const adapter = new ExtensionHostDebugAdapter(host, session());
        const events: unknown[] = [];
        const errors: string[] = [];
        const exits: unknown[] = [];
        adapter.onEvent((e) => events.push(e.event));
        adapter.onError((e) => errors.push(e.message));
        adapter.onExit((code) => exits.push(code));

        await adapter.startSession();
        expect(connection.start).toHaveBeenCalledTimes(1);
        const response = vi.fn();
        adapter.sendRequest("threads", {}, response);
        expect(connection.send).toHaveBeenCalledWith({ type: "request", seq: 1, command: "threads" });

        const { listener } = created[0];
        listener.onMessage({ seq: 1, type: "event", event: "stopped" } as DebugProtocol.Event);
        listener.onMessage({
            seq: 2,
            type: "response",
            request_seq: 1,
            command: "threads",
            success: true,
        } as DebugProtocol.Response);
        listener.onError(new Error("boom"));
        listener.onExit(3);
        listener.onExit(undefined);
        await vi.waitFor(() => {
            expect(response).toHaveBeenCalledTimes(1);
        });
        expect(events).toEqual(["stopped"]);
        expect(errors).toEqual(["boom"]);
        expect(exits).toEqual([3, null]);
        adapter.dispose();
    });

    it("stop cancels the pending requests first (after upstream's half second), then stops the adapter", async () => {
        vi.useFakeTimers();
        try {
            const { host, connection } = fakeHost();
            const adapter = new ExtensionHostDebugAdapter(host, session());
            const response = vi.fn();
            adapter.sendRequest("evaluate", { expression: "x" }, response);

            const stopped = adapter.stopSession();
            await vi.advanceTimersByTimeAsync(499);
            expect(connection.stop).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            await stopped;
            expect(response).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: "canceled" }));
            expect(connection.stop).toHaveBeenCalledTimes(1);
            adapter.dispose();
        } finally {
            vi.useRealTimers();
        }
    });
});
