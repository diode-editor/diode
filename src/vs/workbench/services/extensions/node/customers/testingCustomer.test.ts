import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { CancellationTokenSource } from "../../../../../base/common/cancellation.ts";
import type { SubprocessRpc } from "../../../../api/common/extHostProtocol.ts";
import type {
    IExtensionTestControllerProxy,
    IExtensionTestingSink,
} from "../../../../api/common/iExtensionTestingSink.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";

import { TestingCustomer } from "./testingCustomer.ts";

const PROFILE = {
    controllerId: "c",
    profileId: 1,
    label: "Run",
    group: 2,
    isDefault: false,
    tag: null,
    hasConfigurationHandler: false,
    supportsContinuousRun: false,
} as const;

function recordingSink() {
    const calls: unknown[][] = [];
    const proxies: IExtensionTestControllerProxy[] = [];
    const sink: IExtensionTestingSink = {
        registerController: (controller, proxy) => {
            calls.push(["register", controller]);
            proxies.push(proxy);
        },
        updateController: (patch) => calls.push(["update", patch]),
        unregisterController: (id) => calls.push(["unregister", id]),
        publishDiff: (diff) => calls.push(["diff", diff]),
        publishProfile: (profile) => calls.push(["profile", profile]),
        updateProfile: (update) => calls.push(["updateProfile", update]),
        removeProfile: (controllerId, profileId) => calls.push(["removeProfile", controllerId, profileId]),
        startedExtensionTestRun: (run) => calls.push(["startedExtensionTestRun", run]),
        finishedExtensionTestRun: (runId) => calls.push(["finishedExtensionTestRun", runId]),
        startedTestRunTask: (task) => calls.push(["startedTestRunTask", task]),
        finishedTestRunTask: (task) => calls.push(["finishedTestRunTask", task]),
        addTestsToRun: (add) => calls.push(["addTestsToRun", add]),
        updateTestStateInRun: (update) => calls.push(["updateTestStateInRun", update]),
        appendTestMessagesInRun: (messages) => calls.push(["appendTestMessagesInRun", messages]),
        appendOutputToRun: (output) => calls.push(["appendOutputToRun", output]),
        reset: () => calls.push(["reset"]),
    };
    return { sink, calls, proxies };
}

function setup(sink: IExtensionTestingSink | undefined) {
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b) as unknown as SubprocessRpc;
    const spawn = new TestingCustomer(sink).attach({ rpc: new RpcEndpoint(a), logger: undefined });
    return { peer, spawn };
}

describe("TestingCustomer", () => {
    it("malformed messages never reach the sink; the spawn's end resets it", async () => {
        const { sink, calls } = recordingSink();
        const { peer, spawn } = setup(sink);
        for (const method of [
            "testing.registerController",
            "testing.updateController",
            "testing.unregisterController",
            "testing.publishDiff",
            "testing.publishProfile",
            "testing.updateProfile",
            "testing.removeProfile",
        ] as const) {
            peer.notify(method, null as never);
        }
        await flushMicrotasks();
        expect(calls).toEqual([]);
        spawn.dispose();
        expect(calls).toEqual([["reset"]]);
    });

    it("a controller's proxy asks the subprocess to expand and to refresh, with the cancellation", async () => {
        const { sink, calls, proxies } = recordingSink();
        const { peer } = setup(sink);
        const seen: unknown[] = [];
        let cancelled = false;
        peer.handleRequest("testing.expandTest", (params) => {
            seen.push(["expand", params]);
            return null;
        });
        peer.handleRequest("testing.refreshTests", async (params, token) => {
            seen.push(["refresh", params]);
            await new Promise<void>((resolve) => {
                token.onCancellationRequested(() => {
                    cancelled = true;
                    resolve();
                });
            });
            return null;
        });
        peer.notify("testing.registerController", { controllerId: "c", label: "C", canRefresh: true });
        await flushMicrotasks();
        expect(calls).toEqual([["register", { controllerId: "c", label: "C", canRefresh: true }]]);
        await proxies[0].expandTest("c\0f", 2);
        const cts = new CancellationTokenSource();
        const refreshing = proxies[0].refreshTests(cts.token).catch(() => undefined);
        await flushMicrotasks();
        cts.cancel();
        await refreshing;
        expect(seen).toEqual([
            ["expand", { testId: "c\0f", levels: 2 }],
            ["refresh", { controllerId: "c" }],
        ]);
        expect(cancelled).toBe(true);
    });

    it("well-formed messages reach the sink", async () => {
        const { sink, calls } = recordingSink();
        const { peer } = setup(sink);
        peer.notify("testing.updateController", { controllerId: "c", label: "L" });
        peer.notify("testing.unregisterController", { controllerId: "c" });
        peer.notify("testing.publishDiff", { controllerId: "c", diff: [{ op: 3, itemId: "c" }] });
        peer.notify("testing.publishProfile", PROFILE);
        peer.notify("testing.removeProfile", { controllerId: "c", profileId: 1 });
        peer.notify("testing.updateProfile", { controllerId: "c", profileId: 1, update: { label: "R" } });
        await flushMicrotasks();
        expect(calls).toEqual([
            ["update", { controllerId: "c", label: "L", canRefresh: undefined }],
            ["unregister", "c"],
            ["diff", [{ op: 3, itemId: "c" }]],
            ["profile", PROFILE],
            ["removeProfile", "c", 1],
            ["updateProfile", { controllerId: "c", profileId: 1, update: { label: "R" } }],
        ]);
    });

    it("the run's reports reach the sink parsed; malformed ones never do", async () => {
        const { sink, calls } = recordingSink();
        const { peer } = setup(sink);
        const range = { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } };
        const item = {
            extId: "c",
            label: "C",
            tags: [],
            busy: false,
            range: null,
            description: null,
            error: null,
            sortText: null,
        };
        const methods = [
            "testing.startedExtensionTestRun",
            "testing.finishedExtensionTestRun",
            "testing.startedTestRunTask",
            "testing.finishedTestRunTask",
            "testing.addTestsToRun",
            "testing.updateTestStateInRun",
            "testing.appendTestMessagesInRun",
            "testing.appendOutputToRun",
        ] as const;
        for (const method of methods) peer.notify(method, null as never);
        peer.notify("testing.updateTestStateInRun", { runId: "r", taskId: "t", testId: "c", state: 99 } as never);
        peer.notify("testing.finishedExtensionTestRun", { runId: "" });
        peer.notify("testing.startedTestRunTask", { runId: "r", taskId: "t" } as never);
        peer.notify("testing.addTestsToRun", { runId: "r", controllerId: "c" } as never);
        peer.notify("testing.appendTestMessagesInRun", { runId: "r", taskId: "t", testId: "c" } as never);
        peer.notify("testing.appendOutputToRun", { runId: "r", taskId: "t" } as never);
        peer.notify("testing.startedExtensionTestRun", { runId: "r" } as never);
        await flushMicrotasks();
        expect(calls).toEqual([]);

        peer.notify("testing.startedExtensionTestRun", {
            runId: "r",
            controllerId: "c",
            include: ["c", 3],
            exclude: [],
            profileId: 5,
            preserveFocus: false,
            persist: true,
            continuous: false,
        } as never);
        peer.notify("testing.startedTestRunTask", { runId: "r", taskId: "t", controllerId: "c", name: "vitest" });
        peer.notify("testing.addTestsToRun", {
            runId: "r",
            controllerId: "c",
            tests: [item, { label: "bad" }, item],
        } as never);
        peer.notify("testing.updateTestStateInRun", { runId: "r", taskId: "t", testId: "c", state: 3, duration: 12 });
        peer.notify("testing.updateTestStateInRun", { runId: "r", taskId: "t", testId: "c", state: 4, duration: NaN });
        peer.notify("testing.appendTestMessagesInRun", {
            runId: "r",
            taskId: "t",
            testId: "c",
            messages: [
                {
                    message: "boom",
                    expected: "1",
                    actual: 2,
                    location: { uri: "file:///a.ts", range },
                    stackTrace: [
                        { label: "at", position: { line: 1, character: 2 } },
                        { label: 3 },
                        { label: "x", position: { line: 1 } },
                    ],
                },
                { message: 3 },
                { message: "no location", location: { uri: "file:///a.ts" } },
            ],
        } as never);
        peer.notify("testing.appendOutputToRun", {
            runId: "r",
            taskId: "t",
            output: "hi",
            location: { uri: "file:///a.ts", range },
            testId: "c",
        });
        peer.notify("testing.finishedTestRunTask", { runId: "r", taskId: "t" });
        peer.notify("testing.finishedExtensionTestRun", { runId: "r" });
        peer.notify("testing.startedExtensionTestRun", { runId: "s", controllerId: "c" } as never);
        peer.notify("testing.startedTestRunTask", { runId: "s", taskId: "t", controllerId: "c" } as never);
        await flushMicrotasks();
        expect(calls).toEqual([
            [
                "startedExtensionTestRun",
                {
                    runId: "r",
                    controllerId: "c",
                    include: ["c"],
                    exclude: [],
                    profileId: 5,
                    preserveFocus: false,
                    persist: true,
                    continuous: false,
                },
            ],
            ["startedTestRunTask", { runId: "r", taskId: "t", controllerId: "c", name: "vitest" }],
            // The chain is cut at the malformed test.
            ["addTestsToRun", { runId: "r", controllerId: "c", tests: [{ ...item, uri: undefined }] }],
            ["updateTestStateInRun", { runId: "r", taskId: "t", testId: "c", state: 3, duration: 12 }],
            ["updateTestStateInRun", { runId: "r", taskId: "t", testId: "c", state: 4, duration: undefined }],
            [
                "appendTestMessagesInRun",
                {
                    runId: "r",
                    taskId: "t",
                    testId: "c",
                    messages: [
                        {
                            message: "boom",
                            expected: "1",
                            actual: undefined,
                            contextValue: undefined,
                            location: { uri: "file:///a.ts", range },
                            stackTrace: [
                                { label: "at", uri: undefined, position: { line: 1, character: 2 } },
                                { label: "x", uri: undefined, position: undefined },
                            ],
                        },
                        {
                            message: "no location",
                            expected: undefined,
                            actual: undefined,
                            contextValue: undefined,
                            location: undefined,
                            stackTrace: undefined,
                        },
                    ],
                },
            ],
            [
                "appendOutputToRun",
                { runId: "r", taskId: "t", output: "hi", location: { uri: "file:///a.ts", range }, testId: "c" },
            ],
            ["finishedTestRunTask", { runId: "r", taskId: "t" }],
            ["finishedExtensionTestRun", "r"],
            [
                "startedExtensionTestRun",
                {
                    runId: "s",
                    controllerId: "c",
                    include: [],
                    exclude: [],
                    profileId: null,
                    preserveFocus: true,
                    persist: true,
                    continuous: false,
                },
            ],
            ["startedTestRunTask", { runId: "s", taskId: "t", controllerId: "c", name: "" }],
        ]);
    });

    it("a controller's proxy runs tests with the cancellation and cancels a run; every controller of the spawn shares the cancel", async () => {
        const { sink, proxies } = recordingSink();
        const { peer } = setup(sink);
        const seen: unknown[] = [];
        let cancelled = false;
        peer.handleRequest("testing.runControllerTests", async (params, token) => {
            seen.push(params);
            await new Promise<void>((resolve) => {
                token.onCancellationRequested(() => {
                    cancelled = true;
                    resolve();
                });
            });
            return [{ error: "late" }];
        });
        peer.handleNotification("testing.cancelExtensionTestRun", (params) => {
            seen.push(["cancel", params]);
        });
        peer.notify("testing.registerController", { controllerId: "a", label: "A", canRefresh: false });
        peer.notify("testing.registerController", { controllerId: "b", label: "B", canRefresh: false });
        await flushMicrotasks();
        expect(proxies[0].cancelTestRun).toBe(proxies[1].cancelTestRun);
        const request = { runId: "r", controllerId: "a", profileId: 1, testIds: ["a"], excludeExtIds: [] };
        const cts = new CancellationTokenSource();
        const running = proxies[0].runTests([request], cts.token);
        await flushMicrotasks();
        proxies[0].cancelTestRun("r");
        proxies[1].cancelTestRun("r", "t");
        cts.cancel();
        await expect(running).resolves.toEqual([{ error: "late" }]);
        expect(cancelled).toBe(true);
        expect(seen).toEqual([
            { requests: [request] },
            ["cancel", { runId: "r" }],
            ["cancel", { runId: "r", taskId: "t" }],
        ]);
    });

    it("without a sink nothing is registered and nothing throws", () => {
        const { spawn } = setup(undefined);
        expect(() => {
            spawn.dispose();
        }).not.toThrow();
    });
});
