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

    it("without a sink nothing is registered and nothing throws", () => {
        const { spawn } = setup(undefined);
        expect(() => {
            spawn.dispose();
        }).not.toThrow();
    });
});
