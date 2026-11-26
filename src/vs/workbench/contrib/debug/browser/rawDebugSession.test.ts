/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/test/browser/rawDebugSession.test.ts
// Upstream's reverse-request tests, then ours: what goes out for each request, the capability gates, errors,
// events and the shutdown.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockDebugAdapter, NO_RESPONSE } from "../../../../../TestUtils/mockDebugAdapter.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { CancellationError } from "../../../../base/common/errorSerialization.ts";
import type { AdapterEndEvent, IDebugger } from "../common/debug.ts";

import { DebugRequestError, RawDebugSession } from "./rawDebugSession.ts";

describe("RawDebugSession", () => {
    let adapter: MockDebugAdapter;
    let session: RawDebugSession;
    let dbgr: { type: string; startDebugging: ReturnType<typeof vi.fn>; runInTerminal: ReturnType<typeof vi.fn> };
    let shownErrors: string[];

    beforeEach(() => {
        adapter = new MockDebugAdapter();
        dbgr = { type: "mock-debug", startDebugging: vi.fn(), runInTerminal: vi.fn() };
        shownErrors = [];
        session = new RawDebugSession(adapter, dbgr as unknown as IDebugger, "sessionId", "name", {
            error: (message) => shownErrors.push(message),
        });
    });

    afterEach(() => {
        session.dispose();
        adapter.dispose();
        vi.useRealTimers();
    });

    async function withCapabilities(capabilities: DebugProtocol.Capabilities): Promise<void> {
        adapter.handlers.set("initialize", () => capabilities);
        await session.initialize({ adapterID: "mock" });
    }

    describe("reverse requests", () => {
        it("handles startDebugging request success", async () => {
            dbgr.startDebugging.mockResolvedValue(true);

            adapter.sendRequestBody("startDebugging", {
                request: "launch",
                configuration: { type: "some-other-type" },
            } satisfies DebugProtocol.StartDebuggingRequestArguments);
            const response = await adapter.waitForResponseFromClient("startDebugging");

            expect(response).toMatchObject({ type: "response", command: "startDebugging", success: true });
            expect(dbgr.startDebugging).toHaveBeenCalledWith(
                { type: "mock-debug", request: "launch", name: "name" },
                "sessionId",
            );
        });

        it("handles startDebugging request failure", async () => {
            dbgr.startDebugging.mockResolvedValue(false);

            adapter.sendRequestBody("startDebugging", {
                request: "attach",
                configuration: { type: "some-other-type", name: "child" },
            } satisfies DebugProtocol.StartDebuggingRequestArguments);
            const response = await adapter.waitForResponseFromClient("startDebugging");

            expect(response).toMatchObject({ success: false, message: "Failed to start debugging" });
            expect(dbgr.startDebugging).toHaveBeenCalledWith(
                { type: "mock-debug", request: "attach", name: "child" },
                "sessionId",
            );
        });

        it("answers runInTerminal with the shell's process id", async () => {
            dbgr.runInTerminal.mockResolvedValue(4242);
            const args = { kind: "integrated", cwd: "/", args: ["prog"] };

            adapter.sendRequestBody("runInTerminal", args);
            const response = await adapter.waitForResponseFromClient("runInTerminal");

            expect(response).toMatchObject({ success: true, body: { shellProcessId: 4242 } });
            expect(dbgr.runInTerminal).toHaveBeenCalledWith(args, "sessionId");
        });

        it("answers runInTerminal without a process id when the terminal gives none", async () => {
            dbgr.runInTerminal.mockResolvedValue(undefined);

            adapter.sendRequestBody("runInTerminal", { cwd: "/", args: [] });
            const response = await adapter.waitForResponseFromClient("runInTerminal");

            expect(response.success).toBe(true);
            expect(response.body).toStrictEqual({});
        });

        it("answers a failed reverse request with its error", async () => {
            dbgr.runInTerminal.mockRejectedValue(new Error("no terminal"));

            adapter.sendRequestBody("runInTerminal", { cwd: "/", args: [] });
            const response = await adapter.waitForResponseFromClient("runInTerminal");

            expect(response).toMatchObject({ success: false, message: "no terminal", request_seq: 1 });
        });

        it("answers an unknown request as unknown", async () => {
            adapter.sendRequestBody("launchVSCode", { args: [] });
            const response = await adapter.waitForResponseFromClient("launchVSCode");

            expect(response).toMatchObject({ success: false, message: "unknown request 'launchVSCode'" });
        });
    });

    it("merges the capabilities of initialize, launch and the capabilities event", async () => {
        await withCapabilities({ supportsStepBack: true });
        adapter.handlers.set("launch", () => ({ supportsRestartRequest: true }));
        await session.launchOrAttach({ type: "mock", name: "n", request: "launch" });
        adapter.sendEventBody("capabilities", { capabilities: { supportsStepBack: false } });
        await settle(0);

        expect(session.capabilities).toEqual({ supportsStepBack: false, supportsRestartRequest: true });
        expect(adapter.sent("launch")[0].arguments).toEqual({ type: "mock", name: "n", request: "launch" });
        expect(adapter.sent("initialize")[0].arguments).toEqual({ adapterID: "mock" });
    });

    it("keeps one capabilities object: what was remembered sees later changes", async () => {
        await withCapabilities({ supportsStepBack: true });
        const remembered = session.capabilities;
        adapter.sendEventBody("capabilities", { capabilities: { supportsRestartFrame: true } });
        await settle(0);

        expect(remembered).toEqual({ supportsStepBack: true, supportsRestartFrame: true });
    });

    it("an initialize without a body changes no capability", async () => {
        adapter.handlers.set("initialize", () => undefined);
        await session.initialize({ adapterID: "mock" });

        expect(session.capabilities).toEqual({});
    });

    it("is ready for breakpoints after `initialized`", async () => {
        const initialized = vi.fn();
        session.onDidInitialize(initialized);
        expect(session.readyForBreakpoints).toBe(false);

        adapter.sendEventBody("initialized");
        await settle(0);

        expect(session.readyForBreakpoints).toBe(true);
        expect(initialized).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["loadedSource", "onDidLoadedSource"],
        ["stopped", "onDidStop"],
        ["continued", "onDidContinued"],
        ["thread", "onDidThread"],
        ["output", "onDidOutput"],
        ["breakpoint", "onDidBreakpoint"],
        ["terminated", "onDidTerminateDebugee"],
        ["exited", "onDidExitDebugee"],
        ["progressStart", "onDidProgressStart"],
        ["progressUpdate", "onDidProgressUpdate"],
        ["progressEnd", "onDidProgressEnd"],
        ["invalidated", "onDidInvalidated"],
        ["memory", "onDidInvalidateMemory"],
        ["myCustomEvent", "onDidCustomEvent"],
    ] as const)("the '%s' event fires %s and onDidEvent", async (event, emitter) => {
        const fired = vi.fn();
        const any = vi.fn();
        session[emitter](fired);
        session.onDidEvent(any);
        const body = { threadId: 1, allThreadsContinued: true };

        adapter.sendEventBody(event, body);
        await settle(0);

        expect(fired).toHaveBeenCalledWith(expect.objectContaining({ event, body }));
        expect(any).toHaveBeenCalledWith(expect.objectContaining({ event }));
    });

    it.each(["process", "module"])("the '%s' event fires only onDidEvent", async (event) => {
        const custom = vi.fn();
        const any = vi.fn();
        session.onDidCustomEvent(custom);
        session.onDidEvent(any);

        adapter.sendEventBody(event, {});
        await settle(0);

        expect(custom).not.toHaveBeenCalled();
        expect(any).toHaveBeenCalledTimes(1);
    });

    describe("requests that need a capability", () => {
        const gated: [string, keyof DebugProtocol.Capabilities, (s: RawDebugSession) => Promise<unknown>, string][] = [
            ["restart", "supportsRestartRequest", (s) => s.restart({}), "restart not supported"],
            [
                "terminateThreads",
                "supportsTerminateThreadsRequest",
                (s) => s.terminateThreads({ threadIds: [1] }),
                "terminateThreads not supported",
            ],
            [
                "setVariable",
                "supportsSetVariable",
                (s) => s.setVariable({ variablesReference: 1, name: "a", value: "1" }),
                "setVariable not supported",
            ],
            [
                "setExpression",
                "supportsSetExpression",
                (s) => s.setExpression({ expression: "a", value: "1" }),
                "setExpression not supported",
            ],
            [
                "restartFrame",
                "supportsRestartFrame",
                (s) => s.restartFrame({ frameId: 1 }, 1),
                "restartFrame not supported",
            ],
            [
                "stepInTargets",
                "supportsStepInTargetsRequest",
                (s) => s.stepInTargets({ frameId: 1 }),
                "stepInTargets not supported",
            ],
            [
                "completions",
                "supportsCompletionsRequest",
                (s) => s.completions({ text: "a", column: 1 }, new CancellationTokenSource().token),
                "completions not supported",
            ],
            [
                "setFunctionBreakpoints",
                "supportsFunctionBreakpoints",
                (s) => s.setFunctionBreakpoints({ breakpoints: [] }),
                "setFunctionBreakpoints not supported",
            ],
            [
                "dataBreakpointInfo",
                "supportsDataBreakpoints",
                (s) => s.dataBreakpointInfo({ name: "a" }),
                "dataBreakpointInfo not supported",
            ],
            [
                "setDataBreakpoints",
                "supportsDataBreakpoints",
                (s) => s.setDataBreakpoints({ breakpoints: [] }),
                "setDataBreakpoints not supported",
            ],
            [
                "breakpointLocations",
                "supportsBreakpointLocationsRequest",
                (s) => s.breakpointLocations({ source: {}, line: 1 }),
                "breakpointLocations is not supported",
            ],
            [
                "configurationDone",
                "supportsConfigurationDoneRequest",
                (s) => s.configurationDone(),
                "configurationDone not supported",
            ],
            [
                "exceptionInfo",
                "supportsExceptionInfoRequest",
                (s) => s.exceptionInfo({ threadId: 1 }),
                "exceptionInfo not supported",
            ],
            [
                "loadedSources",
                "supportsLoadedSourcesRequest",
                (s) => s.loadedSources({}),
                "loadedSources not supported",
            ],
            ["stepBack", "supportsStepBack", (s) => s.stepBack({ threadId: 1 }), "stepBack not supported"],
            [
                "reverseContinue",
                "supportsStepBack",
                (s) => s.reverseContinue({ threadId: 1 }),
                "reverseContinue not supported",
            ],
            [
                "gotoTargets",
                "supportsGotoTargetsRequest",
                (s) => s.gotoTargets({ source: {}, line: 1 }),
                "gotoTargets is not supported",
            ],
            [
                "goto",
                "supportsGotoTargetsRequest",
                (s) => s.goto({ threadId: 1, targetId: 2 }),
                "goto is not supported",
            ],
            [
                "setInstructionBreakpoints",
                "supportsInstructionBreakpoints",
                (s) => s.setInstructionBreakpoints({ breakpoints: [] }),
                "setInstructionBreakpoints is not supported",
            ],
            [
                "disassemble",
                "supportsDisassembleRequest",
                (s) => s.disassemble({ memoryReference: "0", instructionCount: 1 }),
                "disassemble is not supported",
            ],
            [
                "readMemory",
                "supportsReadMemoryRequest",
                (s) => s.readMemory({ memoryReference: "0", count: 1 }),
                "readMemory is not supported",
            ],
            [
                "writeMemory",
                "supportsWriteMemoryRequest",
                (s) => s.writeMemory({ memoryReference: "0", data: "" }),
                "writeMemory is not supported",
            ],
            ["terminate", "supportsTerminateRequest", (s) => s.terminate(), "terminated not supported"],
        ];

        it.each(gated)("%s is refused without %s", async (_command, _capability, call, message) => {
            await expect(call(session)).rejects.toThrow(message);
            expect(adapter.requests).toEqual([]);
        });

        it.each(gated)("%s goes out with %s", async (command, capability, call) => {
            await withCapabilities({ [capability]: true });

            await call(session);

            expect(adapter.sent(command)).toHaveLength(1);
        });
    });

    it.each([
        ["setBreakpoints", (s: RawDebugSession) => s.setBreakpoints({ source: {} })],
        ["setExceptionBreakpoints", (s: RawDebugSession) => s.setExceptionBreakpoints({ filters: [] })],
        ["stackTrace", (s: RawDebugSession) => s.stackTrace({ threadId: 1 }, new CancellationTokenSource().token)],
        ["scopes", (s: RawDebugSession) => s.scopes({ frameId: 1 }, new CancellationTokenSource().token)],
        ["variables", (s: RawDebugSession) => s.variables({ variablesReference: 1 })],
        ["source", (s: RawDebugSession) => s.source({ sourceReference: 1 })],
        ["locations", (s: RawDebugSession) => s.locations({ locationReference: 1 })],
        ["threads", (s: RawDebugSession) => s.threads()],
        ["evaluate", (s: RawDebugSession) => s.evaluate({ expression: "a" })],
        ["pause", (s: RawDebugSession) => s.pause({ threadId: 1 })],
        ["cancel", (s: RawDebugSession) => s.cancel({ progressId: "p" })],
        ["myCustom", (s: RawDebugSession) => s.custom("myCustom", { a: 1 })],
    ])("%s needs no capability", async (command, call) => {
        await call(session);

        expect(adapter.sent(command)).toHaveLength(1);
    });

    it("sends `null` arguments of configurationDone and threads as no arguments", async () => {
        await withCapabilities({ supportsConfigurationDoneRequest: true });
        await session.configurationDone();
        await session.threads();

        expect(adapter.sent("configurationDone")[0].arguments).toBeUndefined();
        expect(adapter.sent("threads")[0].arguments).toBeUndefined();
    });

    describe("steps", () => {
        const steps: [string, (s: RawDebugSession) => Promise<unknown>, DebugProtocol.Capabilities][] = [
            ["next", (s) => s.next({ threadId: 7 }), {}],
            ["stepIn", (s) => s.stepIn({ threadId: 7 }), {}],
            ["stepOut", (s) => s.stepOut({ threadId: 7 }), {}],
            ["stepBack", (s) => s.stepBack({ threadId: 7 }), { supportsStepBack: true }],
            ["reverseContinue", (s) => s.reverseContinue({ threadId: 7 }), { supportsStepBack: true }],
            ["goto", (s) => s.goto({ threadId: 7, targetId: 1 }), { supportsGotoTargetsRequest: true }],
            ["restartFrame", (s) => s.restartFrame({ frameId: 1 }, 7), { supportsRestartFrame: true }],
        ];

        it.each(steps)("%s without a stop meanwhile reads as the thread continued", async (_command, step, caps) => {
            await withCapabilities(caps);
            const continued: DebugProtocol.ContinuedEvent[] = [];
            session.onDidContinued((e) => continued.push(e));

            await step(session);

            expect(continued.map((e) => e.body)).toEqual([{ threadId: 7, allThreadsContinued: false }]);
            expect(continued[0]).toMatchObject({ type: "event", event: "continued" });
        });

        it.each(steps)("%s with a stop before its response is no continue", async (command, step, caps) => {
            await withCapabilities(caps);
            const continued = vi.fn();
            session.onDidContinued(continued);
            adapter.handlers.set(command, () => {
                adapter.sendEventBody("stopped", { reason: "step", threadId: 7 });
                return {};
            });

            await step(session);

            expect(continued).not.toHaveBeenCalled();
        });
    });

    it("continue keeps the adapter's word on whether all threads continued", async () => {
        const continued: DebugProtocol.ContinuedEvent["body"][] = [];
        session.onDidContinued((e) => continued.push(e.body));

        await session.continue({ threadId: 3 });
        adapter.handlers.set("continue", () => ({ allThreadsContinued: false }));
        await session.continue({ threadId: 3 });
        adapter.sendEventBody("continued", { threadId: 3 });
        await settle(0);
        adapter.handlers.set("continue", () => undefined);
        await session.continue({ threadId: 3 });

        expect(continued).toEqual([
            { threadId: 3, allThreadsContinued: true },
            { threadId: 3, allThreadsContinued: false },
            { threadId: 3 },
            { threadId: 3, allThreadsContinued: true },
        ]);
    });

    it("a continued event of one thread is remembered for the next continue without a word", async () => {
        adapter.sendEventBody("continued", { threadId: 3, allThreadsContinued: false });
        await settle(0);
        adapter.handlers.set("continue", () => ({}));
        const continued: DebugProtocol.ContinuedEvent["body"][] = [];
        session.onDidContinued((e) => continued.push(e.body));

        await session.continue({ threadId: 3 });

        expect(continued).toEqual([{ threadId: 3, allThreadsContinued: false }]);
    });

    it("a step after the shutdown completes with nothing and no continue", async () => {
        await session.disconnect({});
        const continued = vi.fn();
        session.onDidContinued(continued);

        expect(await session.continue({ threadId: 1 })).toBeUndefined();
    });

    it("after dispose no event reaches a listener", async () => {
        const stopped = vi.fn();
        session.onDidStop(stopped);

        session.dispose();
        adapter.sendEventBody("stopped", { reason: "pause" });
        await settle(0);

        expect(stopped).not.toHaveBeenCalled();
    });

    it("a continued event that says nothing about all threads leaves them continued", async () => {
        adapter.handlers.set("continue", () => ({ allThreadsContinued: false }));
        await session.continue({ threadId: 3 });
        adapter.sendEventBody("continued", { threadId: 3, allThreadsContinued: true });
        await settle(0);
        adapter.handlers.set("continue", () => ({}));
        const continued: DebugProtocol.ContinuedEvent["body"][] = [];
        session.onDidContinued((e) => continued.push(e.body));

        await session.continue({ threadId: 3 });

        expect(continued).toEqual([{ threadId: 3, allThreadsContinued: true }]);
    });

    it("a continue with a stop before its response is no continue", async () => {
        const continued = vi.fn();
        session.onDidContinued(continued);
        adapter.handlers.set("continue", () => {
            adapter.sendEventBody("stopped", { reason: "breakpoint", threadId: 3 });
            return {};
        });

        await session.continue({ threadId: 3 });

        expect(continued).not.toHaveBeenCalled();
    });

    describe("errors", () => {
        it("a failed request rejects with the adapter's message", async () => {
            adapter.handlers.set("evaluate", () => new Error("boom"));

            const error = await session.evaluate({ expression: "a" }).catch((e: unknown) => e);

            expect(error).toBeInstanceOf(DebugRequestError);
            expect(error).toMatchObject({ message: "boom", showUser: undefined });
            expect(shownErrors).toEqual([]);
        });

        it("formats the structured error and shows it when asked to", async () => {
            adapter.handlers.set("evaluate", () => NO_RESPONSE);
            const result = session.evaluate({ expression: "a" }).catch((e: unknown) => e);
            await settle(0);
            adapter.sendErrorResponse(adapter.sent("evaluate")[0], "short", {
                error: { id: 1, format: "cannot read {name}", variables: { name: "x" }, showUser: true },
            });

            expect(await result).toMatchObject({ message: "cannot read x", showUser: true });
            expect(shownErrors).toEqual(["cannot read x"]);
        });

        it("does not show the structured error of initialize, launch or attach", async () => {
            const error = { error: { id: 1, format: "no", showUser: true } };
            adapter.handlers.set("initialize", () => NO_RESPONSE);
            adapter.handlers.set("launch", () => NO_RESPONSE);
            const init = session.initialize({ adapterID: "mock" }).catch((e: unknown) => e);
            const launch = session.launchOrAttach({ type: "m", name: "n", request: "launch" }).catch((e: unknown) => e);
            await settle(0);
            adapter.sendErrorResponse(adapter.sent("initialize")[0], "", error);
            adapter.sendErrorResponse(adapter.sent("launch")[0], "", error);

            expect(await init).toMatchObject({ message: "no", showUser: true });
            expect(await launch).toMatchObject({ message: "no" });
            expect(shownErrors).toEqual([]);
        });

        it("a structured error the adapter keeps to itself is not shown", async () => {
            adapter.handlers.set("evaluate", () => NO_RESPONSE);
            const result = session.evaluate({ expression: "a" }).catch((e: unknown) => e);
            await settle(0);
            adapter.sendErrorResponse(adapter.sent("evaluate")[0], "", { error: { id: 1, format: "quiet" } });

            expect(await result).toMatchObject({ message: "quiet", showUser: undefined });
            expect(shownErrors).toEqual([]);
        });

        it("a failure without a message is an empty message", async () => {
            adapter.handlers.set("evaluate", () => NO_RESPONSE);
            const result = session.evaluate({ expression: "a" }).catch((e: unknown) => e);
            await settle(0);
            const failure: DebugProtocol.Response = {
                type: "response",
                seq: 9,
                request_seq: adapter.sent("evaluate")[0].seq,
                command: "evaluate",
                success: false,
            };
            adapter.acceptMessage(failure);

            expect(await result).toMatchObject({ message: "" });
        });

        it("a cancelled request rejects as cancelled", async () => {
            adapter.handlers.set("evaluate", () => NO_RESPONSE);
            const result = session.evaluate({ expression: "a" }).catch((e: unknown) => e);
            await settle(0);
            adapter.sendErrorResponse({ ...adapter.sent("evaluate")[0], command: "canceled" }, "canceled");

            expect(await result).toBeInstanceOf(CancellationError);
        });

        it("a 'canceled' message of another command is an error", async () => {
            adapter.handlers.set("evaluate", () => new Error("canceled"));

            expect(await session.evaluate({ expression: "a" }).catch((e: unknown) => e)).toBeInstanceOf(
                DebugRequestError,
            );
        });

        it("a failure of the 'canceled' command with another message is an error", async () => {
            adapter.handlers.set("evaluate", () => NO_RESPONSE);
            const result = session.evaluate({ expression: "a" }).catch((e: unknown) => e);
            await settle(0);
            adapter.sendErrorResponse({ ...adapter.sent("evaluate")[0], command: "canceled" }, "other");

            expect(await result).toBeInstanceOf(DebugRequestError);
        });
    });

    describe("cancellation", () => {
        it("cancels the request at the adapter when the token is cancelled and the adapter can", async () => {
            await withCapabilities({ supportsCancelRequest: true });
            adapter.handlers.set("stackTrace", () => NO_RESPONSE);
            const source = new CancellationTokenSource();
            void session.stackTrace({ threadId: 1 }, source.token);

            source.cancel();
            source.cancel();

            expect(adapter.sent("cancel").map((r) => r.arguments as unknown)).toEqual([
                { requestId: adapter.sent("stackTrace")[0].seq },
            ]);
        });

        it("does not send cancel to an adapter that cannot", async () => {
            adapter.handlers.set("stackTrace", () => NO_RESPONSE);
            const source = new CancellationTokenSource();
            void session.stackTrace({ threadId: 1 }, source.token);

            source.cancel();

            expect(adapter.sent("cancel")).toEqual([]);
        });

        it("stops listening to the token once the response came", async () => {
            await withCapabilities({ supportsCancelRequest: true });
            const source = new CancellationTokenSource();
            await session.scopes({ frameId: 1 }, source.token);

            source.cancel();

            expect(adapter.sent("cancel")).toEqual([]);
        });
    });

    describe("terminate", () => {
        it("asks to terminate once, then disconnects with terminating the debuggee", async () => {
            await withCapabilities({ supportsTerminateRequest: true, supportTerminateDebuggee: true });

            await session.terminate(true);
            await session.terminate();

            expect(adapter.sent("terminate").map((r) => r.arguments as unknown)).toEqual([{ restart: true }]);
            expect(adapter.sent("disconnect").map((r) => r.arguments as unknown)).toEqual([
                { restart: false, terminateDebuggee: true },
            ]);
        });
    });

    describe("shutdown", () => {
        it("disconnects, stops the adapter and reports the end once", async () => {
            await withCapabilities({ supportTerminateDebuggee: true, supportSuspendDebuggee: true });
            const ends: AdapterEndEvent[] = [];
            session.onDidExitAdapter((e) => ends.push(e));

            await session.disconnect({ restart: true, terminateDebuggee: false, suspendDebuggee: true });
            await session.disconnect({});

            expect(adapter.sent("disconnect").map((r) => r.arguments as unknown)).toEqual([
                { restart: true, terminateDebuggee: false, suspendDebuggee: true },
            ]);
            expect(adapter.stopped).toBe(true);
            expect(ends).toEqual([{ emittedStopped: false, sessionLengthInSeconds: 0 }]);
            expect(session.isInShutdown).toBe(true);
        });

        it("leaves out what the adapter cannot do with the debuggee", async () => {
            await withCapabilities({ supportSuspendDebuggee: true });

            await session.disconnect({ terminateDebuggee: true, suspendDebuggee: true });

            expect(adapter.sent("disconnect")[0].arguments).toStrictEqual({ restart: false });
        });

        it("suspends only with terminate-debuggee support", async () => {
            await withCapabilities({ supportTerminateDebuggee: true });

            await session.disconnect({ terminateDebuggee: true, suspendDebuggee: true });

            expect(adapter.sent("disconnect")[0].arguments).toStrictEqual({ restart: false, terminateDebuggee: true });
        });

        it("remembers that the debugger stopped", async () => {
            const ends: AdapterEndEvent[] = [];
            session.onDidExitAdapter((e) => ends.push(e));
            adapter.sendEventBody("stopped", { reason: "entry" });
            await settle(0);

            await session.disconnect({});

            expect(ends).toEqual([{ emittedStopped: true, sessionLengthInSeconds: 0 }]);
        });

        it("waits two seconds for the disconnect of a healthy adapter", async () => {
            vi.useFakeTimers();
            adapter.handlers.set("disconnect", () => NO_RESPONSE);
            const ended = vi.fn();
            session.onDidExitAdapter(ended);

            const done = session.disconnect({});
            await vi.advanceTimersByTimeAsync(1999);
            expect(ended).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            await done;

            expect(ended).toHaveBeenCalledTimes(1);
        });

        it("an adapter error shuts down after 200 ms and reports the error only if the adapter did not stop", async () => {
            vi.useFakeTimers();
            adapter.handlers.set("disconnect", () => NO_RESPONSE);
            const ends: AdapterEndEvent[] = [];
            session.onDidExitAdapter((e) => ends.push(e));

            adapter.fireError(new Error("crash"));
            await vi.advanceTimersByTimeAsync(199);
            expect(ends).toEqual([]);
            await vi.advanceTimersByTimeAsync(1);

            expect(adapter.stopped).toBe(true);
            expect(ends).toEqual([{ emittedStopped: false, sessionLengthInSeconds: 0, failure: new Error("crash") }]);
        });

        it("only the first error of an adapter that went away by itself is its failure; one after a disconnect is none", async () => {
            const ends: AdapterEndEvent[] = [];
            session.onDidExitAdapter((e) => ends.push(e));
            adapter.fireError(new Error("first"));
            adapter.fireExit(4);
            await vi.waitFor(() => {
                expect(ends).toHaveLength(1);
            });
            expect(ends[0].failure).toEqual(new Error("first"));

            const other = new MockDebugAdapter();
            const second = new RawDebugSession(other, dbgr as unknown as IDebugger, "s2", "name", { error: vi.fn() });
            const secondEnds: AdapterEndEvent[] = [];
            second.onDidExitAdapter((e) => secondEnds.push(e));
            other.handlers.set("disconnect", () => {
                other.fireError(new Error("read error"));
                other.fireExit(1);
                return {};
            });
            await second.disconnect({});
            expect(secondEnds).toStrictEqual([{ emittedStopped: false, sessionLengthInSeconds: 0 }]);
            second.dispose();
            other.dispose();
        });

        it("an adapter that fails to stop reports the error, and the failure goes to the unexpected errors", async () => {
            vi.useFakeTimers();
            const unexpected: unknown[] = [];
            setUnexpectedErrorHandler((e) => unexpected.push(e));
            adapter.handlers.set("disconnect", () => NO_RESPONSE);
            adapter.stopSession = () => Promise.reject(new Error("stuck"));
            const ends: AdapterEndEvent[] = [];
            session.onDidExitAdapter((e) => ends.push(e));

            try {
                adapter.fireExit(3);
                await vi.advanceTimersByTimeAsync(200);
            } finally {
                setUnexpectedErrorHandler((e) => {
                    console.error(e);
                });
            }

            expect(ends).toEqual([
                {
                    emittedStopped: false,
                    sessionLengthInSeconds: 0,
                    error: new Error("exit code: 3"),
                    failure: new Error("exit code: 3"),
                },
            ]);
            expect(unexpected).toEqual([new Error("stuck")]);
        });

        it("an adapter error that fails to stop goes to the unexpected errors", async () => {
            vi.useFakeTimers();
            const unexpected: unknown[] = [];
            setUnexpectedErrorHandler((e) => unexpected.push(e));
            adapter.stopSession = () => Promise.reject(new Error("stuck"));

            try {
                adapter.fireError(new Error("crash"));
                await vi.advanceTimersByTimeAsync(200);
            } finally {
                setUnexpectedErrorHandler((e) => {
                    console.error(e);
                });
            }

            expect(unexpected).toEqual([new Error("stuck")]);
        });

        it("a clean exit of an adapter that fails to stop carries no error", async () => {
            const unexpected: unknown[] = [];
            setUnexpectedErrorHandler((e) => unexpected.push(e));
            adapter.stopSession = () => Promise.reject(new Error("stuck"));
            const ends: AdapterEndEvent[] = [];
            session.onDidExitAdapter((e) => ends.push(e));

            adapter.fireExit(0);
            await vi.waitFor(() => {
                expect(ends).toStrictEqual([{ emittedStopped: false, sessionLengthInSeconds: 0 }]);
            });
            expect(unexpected).toEqual([new Error("stuck")]);
        });

        it("a clean exit of the adapter ends the session without an error", async () => {
            const ends: AdapterEndEvent[] = [];
            session.onDidExitAdapter((e) => ends.push(e));

            adapter.fireExit(0);
            await vi.waitFor(() => {
                expect(ends).toEqual([{ emittedStopped: false, sessionLengthInSeconds: 0 }]);
            });
        });

        it("after the shutdown requests complete with nothing", async () => {
            await session.disconnect({});

            expect(await session.threads()).toBeUndefined();
            expect(await session.initialize({ adapterID: "mock" })).toBeUndefined();
            expect(await session.launchOrAttach({ type: "m", name: "n", request: "launch" })).toBeUndefined();
            expect(session.capabilities).toEqual({});
            expect(adapter.sent("threads")).toEqual([]);
        });

        it("reverse requests after the shutdown get no response", async () => {
            await session.disconnect({});
            const sent = vi.spyOn(adapter, "sendResponse");

            adapter.sendRequestBody("unknownReverse", {});
            await settle(0);
            await settle(0);

            expect(sent).not.toHaveBeenCalled();
        });
    });

    it("starts the adapter", async () => {
        const start = vi.spyOn(adapter, "startSession");

        await session.start();

        expect(start).toHaveBeenCalledTimes(1);
    });

    it("cannot start once the adapter is gone", async () => {
        await session.disconnect({});

        await expect(session.start()).rejects.toThrow("No debug adapter, can not start debug session.");
    });
});
