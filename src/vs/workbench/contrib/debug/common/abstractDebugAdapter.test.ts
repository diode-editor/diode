/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/test/common/abstractDebugAdapter.test.ts
// Upstream's event-ordering suite, then ours: the callbacks, timeouts and cancellation of pending requests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockDebugAdapter, NO_RESPONSE } from "../../../../../TestUtils/mockDebugAdapter.ts";
import { settle } from "../../../../../TestUtils/timing.ts";

describe("Debug - AbstractDebugAdapter", () => {
    let adapter: MockDebugAdapter;

    beforeEach(() => {
        adapter = new MockDebugAdapter();
    });

    afterEach(() => {
        adapter.dispose();
        vi.useRealTimers();
    });

    describe("event ordering", () => {
        let output: string[];

        beforeEach(() => {
            output = [];
            adapter.onEvent((ev) => {
                output.push((ev as DebugProtocol.OutputEvent).body.output);
                void Promise.resolve().then(() => output.push("--end microtask--"));
            });
        });

        const evaluate = async (expression: string): Promise<void> => {
            await new Promise((resolve) => adapter.sendRequest("evaluate", { expression }, resolve));
            output.push(`=${expression}`);
            void Promise.resolve().then(() => output.push("--end microtask--"));
        };

        it("inserts task boundary before response", async () => {
            await evaluate("before.foo");
            await settle(0);

            expect(output).toEqual(["before.foo", "--end microtask--", "=before.foo", "--end microtask--"]);
        });

        it("inserts task boundary after response", async () => {
            await evaluate("after.foo");
            await settle(0);

            expect(output).toEqual(["=after.foo", "--end microtask--", "after.foo", "--end microtask--"]);
        });

        it("does not insert boundaries between events", async () => {
            adapter.sendEventBody("output", { output: "a" });
            adapter.sendEventBody("output", { output: "b" });
            adapter.sendEventBody("output", { output: "c" });
            await settle(0);

            expect(output).toEqual(["a", "b", "c", "--end microtask--", "--end microtask--", "--end microtask--"]);
        });
    });

    it("numbers what it sends and drops empty arguments", () => {
        adapter.sendRequest("threads", {}, () => undefined);
        adapter.sendRequest("pause", { threadId: 1 }, () => undefined);

        expect(adapter.requests).toEqual([
            { type: "request", seq: 1, command: "threads" },
            { type: "request", seq: 2, command: "pause", arguments: { threadId: 1 } },
        ]);
        expect(adapter.getPendingRequestIds()).toEqual([1, 2]);
    });

    it("hands requests from the adapter to the request callback", async () => {
        const requests: string[] = [];
        adapter.onRequest((request) => requests.push(request.command));

        adapter.sendRequestBody("runInTerminal", {});
        await settle(0);

        expect(requests).toEqual(["runInTerminal"]);
    });

    it("hands every message to the message callback instead of the queue", () => {
        const messages: DebugProtocol.ProtocolMessage[] = [];
        const events: DebugProtocol.Event[] = [];
        adapter.onMessage((message) => messages.push(message));
        adapter.onEvent((event) => events.push(event));

        adapter.sendEventBody("output", { output: "x" });

        expect(messages).toEqual([{ seq: 1, type: "event", event: "output", body: { output: "x" } }]);
        expect(events).toEqual([]);
    });

    it.each([
        [
            "Message",
            (a: MockDebugAdapter) => {
                a.onMessage(() => undefined);
            },
        ],
        [
            "Event",
            (a: MockDebugAdapter) => {
                a.onEvent(() => undefined);
            },
        ],
        [
            "Request",
            (a: MockDebugAdapter) => {
                a.onRequest(() => undefined);
            },
        ],
    ])("reports a second '%s' callback as an error", (kind, register) => {
        const errors: string[] = [];
        adapter.onError((e) => errors.push(e.message));

        register(adapter);
        expect(errors).toEqual([]);
        register(adapter);

        expect(errors).toEqual([`attempt to set more than one '${kind}' callback`]);
    });

    it("sends a response once: one already numbered is an error", () => {
        const errors: string[] = [];
        adapter.onError((e) => errors.push(e.message));
        const response: DebugProtocol.Response = {
            type: "response",
            seq: 0,
            request_seq: 7,
            command: "runInTerminal",
            success: true,
        };

        adapter.sendResponse(response);
        adapter.sendResponse(response);

        expect(response).toMatchObject({ seq: 1, type: "response" });
        expect(errors).toEqual(["attempt to send more than one response for command runInTerminal"]);
    });

    it("answers a request that outlives its timeout with a failure", async () => {
        vi.useFakeTimers();
        adapter.handlers.set("threads", () => NO_RESPONSE);
        const responses: DebugProtocol.Response[] = [];

        const seq = adapter.sendRequest("threads", {}, (r) => responses.push(r), 100);
        await vi.advanceTimersByTimeAsync(99);
        expect(responses).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);

        expect(responses).toEqual([
            {
                type: "response",
                seq: 0,
                request_seq: seq,
                success: false,
                command: "threads",
                message: "Timeout after 100 ms for 'threads'",
            },
        ]);
        expect(adapter.getPendingRequestIds()).toEqual([]);
    });

    it("forgets the timeout of a request that was answered", async () => {
        vi.useFakeTimers();
        const responses: DebugProtocol.Response[] = [];

        adapter.sendRequest("threads", {}, (r) => responses.push(r), 100);
        await vi.advanceTimersByTimeAsync(10);
        expect(responses.map((r) => r.success)).toEqual([true]);
        await vi.advanceTimersByTimeAsync(200);

        expect(responses).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("ignores a response nobody waits for", async () => {
        const responses: DebugProtocol.Response[] = [];
        adapter.sendRequest("threads", {}, (r) => responses.push(r));
        await settle(0);
        await settle(0);

        adapter.sendResponseBody({ type: "request", seq: 1, command: "threads" }, {});
        await settle(0);

        expect(responses).toHaveLength(1);
    });

    it("cancels the pending requests half a second later", async () => {
        vi.useFakeTimers();
        adapter.handlers.set("threads", () => NO_RESPONSE);
        const responses: DebugProtocol.Response[] = [];
        adapter.sendRequest("threads", {}, (r) => responses.push(r), 5000);

        const cancelled = (adapter as unknown as { cancelPendingRequests(): Promise<void> }).cancelPendingRequests();
        await vi.advanceTimersByTimeAsync(499);
        expect(responses).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        await cancelled;

        expect(responses).toEqual([
            { type: "response", seq: 0, request_seq: 1, success: false, command: "canceled", message: "canceled" },
        ]);
        expect(adapter.getPendingRequestIds()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("cancels nothing at once when nothing is pending", async () => {
        vi.useFakeTimers();
        await (adapter as unknown as { cancelPendingRequests(): Promise<void> }).cancelPendingRequests();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("on dispose drops the timers, the queued messages and the listeners", async () => {
        vi.useFakeTimers();
        const events: string[] = [];
        const responses: DebugProtocol.Response[] = [];
        const errors = vi.fn();
        const exits = vi.fn();
        adapter.onEvent((e) => events.push(e.event));
        adapter.onError(errors);
        adapter.onExit(exits);
        adapter.handlers.set("threads", () => NO_RESPONSE);
        adapter.sendRequest("threads", {}, (r) => responses.push(r), 100);
        adapter.sendEventBody("output", {});

        adapter.dispose();
        await vi.advanceTimersByTimeAsync(1000);
        adapter.fireError(new Error("late"));
        adapter.fireExit(1);

        expect(events).toEqual([]);
        expect(responses).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        expect(errors).not.toHaveBeenCalled();
        expect(exits).not.toHaveBeenCalled();
    });

    it("without callbacks the adapter's events and requests go nowhere", async () => {
        adapter.sendEventBody("output", {});
        adapter.sendRequestBody("runInTerminal", {});
        await settle(0);
        await settle(0);

        expect(adapter.getPendingRequestIds()).toEqual([]);
    });
});
