// What the core tells extensions about its sessions, focus and breakpoints, and what extensions ask of them: the
// `ExtensionDebugAdapter` over a real `DebugService` (upstream `MainThreadDebugService`).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import { MockDebugAdapter } from "../../../../../TestUtils/mockDebugAdapter.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IWireDebugSession } from "../../../api/common/debugWireTypes.ts";
import type { IExtensionDebugEvents } from "../../../api/common/iExtensionDebugSink.ts";
import { type IConfig, type IDebugSession, State } from "../common/debug.ts";
import type { DebugModel } from "../common/debugModel.ts";
import type { ViewModel } from "../common/debugViewModel.ts";

import { ExtensionDebugAdapter } from "./extensionDebugAdapter.ts";

const MOCK_CONFIG: IConfig = { type: "mock", name: "Mock", request: "launch" };
const FILE = Uri.file("/w/main.c");

describe("ExtensionDebugAdapter — the core's sessions for extensions", () => {
    let fx: IDebugServiceFixture;
    let synthetic: SyntheticDebugAdapterFactory;
    const mocks: MockDebugAdapter[] = [];
    /** Each mock adapter's `launch` handler runs this first. */
    let onLaunch: (adapter: MockDebugAdapter) => void;
    let journal: string[];
    let subscription: IDisposable;
    let sink: ExtensionDebugAdapter;

    const name = (session: IWireDebugSession | undefined): string => session?.name ?? "none";

    function recordingEvents(): IExtensionDebugEvents {
        return {
            sessionStarted: (s) => journal.push(`started ${name(s)}`),
            sessionTerminated: (s) => journal.push(`terminated ${name(s)}`),
            activeSessionChanged: (s) => journal.push(`active ${name(s)}`),
            sessionNameChanged: (s, n) => journal.push(`renamed ${s.id === session().getId() ? "it" : "?"} ${n}`),
            sessionCustomEvent: (s, event, body) => journal.push(`custom ${name(s)} ${event} ${JSON.stringify(body)}`),
            breakpointsChanged: (delta) => journal.push(`breakpoints ${JSON.stringify(delta)}`),
            stackFocusChanged: (focus) =>
                journal.push(
                    focus === undefined
                        ? "focus none"
                        : `focus ${name(focus.session)} thread ${focus.threadId} frame ${focus.frameId ?? "-"}`,
                ),
        };
    }

    beforeEach(() => {
        fx = createDebugServiceFixture();
        synthetic = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
        onLaunch = () => undefined;
        fx.service.getAdapterManager().registerDebugger({ type: "mock" });
        fx.service.getAdapterManager().registerDebugAdapterFactory(["mock"], {
            createDebugAdapter: () => {
                const adapter = new MockDebugAdapter();
                adapter.handlers.set("launch", () => {
                    onLaunch(adapter);
                    return {};
                });
                mocks.push(adapter);
                return adapter;
            },
            substituteVariables: (_folder, config) => Promise.resolve(config),
        });
        journal = [];
        sink = new ExtensionDebugAdapter(() => fx.service);
        subscription = sink.subscribe(recordingEvents());
    });

    afterEach(async () => {
        subscription.dispose();
        await fx.service.stopSession(undefined);
        for (const adapter of synthetic.adapters) adapter.dispose();
        for (const adapter of mocks.splice(0)) adapter.dispose();
        fx.service.dispose();
    });

    /** The service's own model and view model: the tests change them as the views and the adapter answers do. */
    const debugModel = (): DebugModel => fx.service.getModel() as DebugModel;
    const viewModel = (): ViewModel => fx.service.getViewModel() as ViewModel;

    function session(): IDebugSession {
        return fx.service.getModel().getSessions(true)[0];
    }

    async function startMock(): Promise<IDebugSession> {
        expect(await fx.service.startDebugging(undefined, MOCK_CONFIG)).toBe(true);
        return session();
    }

    async function stopAll(): Promise<void> {
        await fx.service.stopSession(undefined);
        await vi.waitFor(() => {
            expect(fx.service.getModel().getSessions()).toHaveLength(0);
        });
    }

    describe("session events — upstream $acceptDebugSession*", () => {
        it("a custom event during the launch, the start, the focus, a rename and the end, in order", async () => {
            onLaunch = (adapter) => {
                adapter.sendEventBody("lldbModules", { count: 3 });
            };
            const started = await startMock();
            await vi.waitFor(() => {
                expect(journal).toContain('custom Mock lldbModules {"count":3}');
            });
            started.setName("Renamed");
            await stopAll();

            expect(journal).toEqual([
                'custom Mock lldbModules {"count":3}',
                "active Mock",
                "started Mock",
                "renamed it Renamed",
                "terminated Renamed",
                "active none",
            ]);
        });

        it("a restarted session keeps its listeners: its custom events go on", async () => {
            const started = await startMock();
            await fx.service.restartSession(started);
            await vi.waitFor(() => {
                expect(mocks).toHaveLength(2);
            });
            journal.length = 0;
            mocks[1]?.sendEventBody("after", 1);
            await vi.waitFor(() => {
                expect(journal).toEqual(["custom Mock after 1"]);
            });
            started.setName("Again");
            expect(journal).toEqual(["custom Mock after 1", "renamed it Again"]);
        });

        it("an ended session's listeners go; so do all of them with the subscription", async () => {
            const first = await startMock();
            await stopAll();
            journal.length = 0;
            first.setName("Late");
            expect(journal).toEqual([]);

            const second = await startMock();
            subscription.dispose();
            journal.length = 0;
            second.setName("Gone");
            mocks[1]?.sendEventBody("gone");
            await stopAll();
            expect(journal).toEqual([]);
        });

        it("the focused thread and frame, then nothing", async () => {
            expect(await fx.service.startDebugging(undefined, SYNTHETIC_LAUNCH_CONFIG)).toBe(true);
            await vi.waitFor(() => {
                expect(fx.service.state).toBe(State.Stopped);
            });
            const frame = fx.service.getViewModel().focusedStackFrame;
            const where = `${frame?.thread.session.name} thread ${frame?.thread.threadId}`;
            expect(journal).toContain(`focus ${where} frame ${frame?.frameId}`);

            journal.length = 0;
            viewModel().setFocus(undefined, frame?.thread, frame?.thread.session, true);
            viewModel().setFocus(undefined, undefined, undefined, true);
            expect(journal.filter((line) => line.startsWith("focus"))).toEqual([
                `focus ${where} frame -`,
                "focus none",
            ]);
        });

        it("the session goes whole: folder, configuration and parent", async () => {
            const sessions: IWireDebugSession[] = [];
            subscription.dispose();
            subscription = sink.subscribe({ ...recordingEvents(), sessionStarted: (s) => sessions.push(s) });
            const parent = await startMock();
            expect(
                await fx.service.startDebugging(
                    undefined,
                    { ...MOCK_CONFIG, name: "Child" },
                    { parentSession: parent },
                ),
            ).toBe(true);

            const [first, child] = sessions as [IWireDebugSession, IWireDebugSession];
            expect(first).toMatchObject({ id: parent.getId(), type: "mock", name: "Mock", configuration: MOCK_CONFIG });
            expect(first).not.toHaveProperty("parentId");
            expect(first).not.toHaveProperty("folder");
            expect(child).toMatchObject({ name: "Child", parentId: parent.getId() });
        });
    });

    describe("requests of extensions — upstream $customDebugAdapterRequest and the rest", () => {
        it("customRequest: the body of a success, the message of a failure, an unknown session", async () => {
            const started = await startMock();
            const adapter = mocks[0];
            adapter.handlers.set("readMemory", (args) => ({ data: "AAA=", args }));
            adapter.handlers.set("broken", () => new Error("cannot do that"));

            await expect(sink.customRequest(started.getId(), "readMemory", { count: 2 })).resolves.toEqual({
                data: "AAA=",
                args: { count: 2 },
            });
            await expect(sink.customRequest(started.getId(), "broken", undefined)).rejects.toThrow("cannot do that");
            await expect(sink.customRequest("nope", "x", undefined)).rejects.toThrow("debug session not found");
        });

        it("customRequest of a session without a response fails as upstream", async () => {
            const started = await startMock();
            vi.spyOn(started, "customRequest").mockResolvedValue(undefined);
            await expect(sink.customRequest(started.getId(), "x", undefined)).rejects.toThrow("custom request failed");
        });

        it("getDebugProtocolBreakpoint: the adapter's breakpoint of the session; an unknown session rejects", async () => {
            const started = await startMock();
            await expect(sink.getDebugProtocolBreakpoint(started.getId(), "nope")).resolves.toBeUndefined();
            vi.spyOn(started, "getDebugProtocolBreakpoint").mockReturnValue({ id: 3, verified: true });
            await expect(sink.getDebugProtocolBreakpoint(started.getId(), "b")).resolves.toEqual({
                id: 3,
                verified: true,
            });
            await expect(sink.getDebugProtocolBreakpoint("nope", "b")).rejects.toThrow("debug session not found");
        });

        it("an ended session is still found, as upstream: its request fails for want of an adapter", async () => {
            const ended = await startMock();
            await stopAll();

            await expect(sink.customRequest(ended.getId(), "x", undefined)).rejects.toThrow(
                "No debugger available, can not send 'x'",
            );
            await expect(sink.getDebugProtocolBreakpoint(ended.getId(), "b")).resolves.toBeUndefined();
        });

        it("setSessionName renames the session; an unknown one is no error", async () => {
            const started = await startMock();
            sink.setSessionName(started.getId(), "From extension");
            sink.setSessionName("nope", "x");
            expect(started.name).toBe("From extension");
        });

        it("appendDebugConsole writes into the focused session's console as a warning; no session — nowhere", async () => {
            sink.appendDebugConsole("lost");
            const started = await startMock();
            sink.appendDebugConsole("from the extension\n");

            const outputs = started
                .getReplElements()
                .map((e) => e as unknown as { value?: string; severity?: string })
                .filter((e) => ["extension", "lost"].some((word) => e.value?.includes(word) === true));
            expect(outputs.map((e) => [e.value, e.severity])).toEqual([["from the extension\n", "warning"]]);
        });
    });

    describe("breakpoints — upstream $acceptBreakpointsDelta, $registerBreakpoints, $unregisterBreakpoints", () => {
        it("the breakpoints there are come first; then additions, changes and removals, 0-based", async () => {
            subscription.dispose();
            const model = debugModel();
            await fx.service.addBreakpoints(FILE, [{ lineNumber: 3, column: 5, condition: "i > 1" }]);
            journal = [];
            subscription = sink.subscribe(recordingEvents());
            const [first] = model.getBreakpoints();

            await fx.service.addBreakpoints(FILE, [{ lineNumber: 1, enabled: false, logMessage: "hi" }]);
            const second = model.getBreakpoints().find((bp) => bp.lineNumber === 1);
            model.setEnablement(second as never, true);
            model.removeBreakpoints([first as never]);

            const id1 = first.getId();
            const id2 = second?.getId();
            const uri = FILE.toString();
            expect(journal.map((line) => JSON.parse(line.slice("breakpoints ".length)) as unknown)).toEqual([
                {
                    added: [{ type: "source", id: id1, enabled: true, condition: "i > 1", uri, line: 2, character: 4 }],
                    removed: [],
                    changed: [],
                },
                {
                    added: [{ type: "source", id: id2, enabled: false, logMessage: "hi", uri, line: 0, character: 0 }],
                    removed: [],
                    changed: [],
                },
                {
                    added: [],
                    removed: [],
                    changed: [{ type: "source", id: id2, enabled: true, logMessage: "hi", uri, line: 0, character: 0 }],
                },
                { added: [], removed: [id1], changed: [] },
            ]);
        });

        it("nothing at subscribe without breakpoints; session-only changes and data breakpoints stay in the core", async () => {
            expect(journal).toEqual([]);
            const model = debugModel();
            model.addFunctionBreakpoint({ name: "main" });
            const [fbp] = model.getFunctionBreakpoints();
            journal.length = 0;
            model.setBreakpointSessionData("s1", { supportsFunctionBreakpoints: true }, new Map());
            model.addDataBreakpoint({
                description: "x",
                src: { type: 0, dataId: "x" },
                canPersist: false,
                accessTypes: undefined,
                accessType: "write",
            });
            expect(journal).toEqual(['breakpoints {"added":[],"removed":[],"changed":[]}']);
            expect(fbp.name).toBe("main");
        });

        it("a function breakpoint goes with its name", () => {
            debugModel().addFunctionBreakpoint({ name: "main", hitCondition: "2" }, "f1");
            expect(journal).toEqual([
                `breakpoints ${JSON.stringify({ added: [{ type: "function", id: "f1", enabled: true, hitCondition: "2", functionName: "main" }], removed: [], changed: [] })}`,
            ]);
        });

        it("breakpoints of an extension join the model under their ids, 1-based; a column 0 is none; removal by id", async () => {
            const model = fx.service.getModel();
            sink.registerBreakpoints({
                breakpoints: [
                    {
                        type: "sourceMulti",
                        uri: FILE.toString(),
                        lines: [
                            { id: "a", enabled: true, line: 4, character: 0, condition: "c", mode: "hw" },
                            { id: "b", enabled: false, line: 9, character: 3, hitCondition: "2", logMessage: "l" },
                        ],
                    },
                    { type: "function", id: "f", enabled: true, functionName: "main", condition: "x", mode: "m" },
                ],
            });
            await vi.waitFor(() => {
                expect(model.getBreakpoints()).toHaveLength(2);
            });

            expect(
                model.getBreakpoints().map((bp) => ({
                    id: bp.getId(),
                    uri: bp.uri.toString(),
                    line: bp.lineNumber,
                    column: bp.column,
                    enabled: bp.enabled,
                    condition: bp.condition,
                    hitCondition: bp.hitCondition,
                    logMessage: bp.logMessage,
                    mode: bp.mode,
                })),
            ).toEqual([
                {
                    id: "a",
                    uri: FILE.toString(),
                    line: 5,
                    column: undefined,
                    enabled: true,
                    condition: "c",
                    hitCondition: undefined,
                    logMessage: undefined,
                    mode: "hw",
                },
                {
                    id: "b",
                    uri: FILE.toString(),
                    line: 10,
                    column: 4,
                    enabled: false,
                    condition: undefined,
                    hitCondition: "2",
                    logMessage: "l",
                    mode: undefined,
                },
            ]);
            expect(
                model.getFunctionBreakpoints().map((bp) => [bp.getId(), bp.name, bp.condition, bp.enabled, bp.mode]),
            ).toEqual([["f", "main", "x", true, "m"]]);

            sink.unregisterBreakpoints({ breakpointIds: ["a"], functionBreakpointIds: ["f"] });
            await vi.waitFor(() => {
                expect(model.getBreakpoints().map((bp) => bp.getId())).toEqual(["b"]);
            });
            expect(model.getFunctionBreakpoints()).toEqual([]);
        });
    });
});
