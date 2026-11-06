import { describe, expect, it, vi } from "vitest";

import { makeTestingServices } from "../../../../../TestUtils/testingServices.ts";
import { testId, testTree } from "../../../../../TestUtils/testTree.ts";
import { assertReturnsDefined } from "../../../../base/common/assert.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import {
    type IWireRunControllerTestsResult,
    type IWireStartControllerTests,
    type IWireTestItem,
    type IWireTestRunProfile,
    TestRunProfileBitset,
    type WireTestsDiffOp,
} from "../../../api/common/testingWireTypes.ts";

import type { ITestController } from "./testService.ts";

function wireItem(extId: string, label = extId.split("\0").at(-1)!): IWireTestItem {
    return { extId, label, tags: [], busy: false, range: null, description: null, error: null, sortText: null };
}

function add(extId: string, expand: 0 | 1 | 2 | 3 = 0): WireTestsDiffOp {
    return { op: 0, item: { expand, item: wireItem(extId) } };
}

function controller(id: string, overrides: Partial<ITestController> = {}): ITestController {
    return {
        id,
        label: id,
        canRefresh: false,
        expandTest: () => Promise.resolve(),
        refreshTests: () => Promise.resolve(),
        runTests: () => Promise.resolve([]),
        cancelTestRun: () => undefined,
        ...overrides,
    };
}

function setup() {
    const services = makeTestingServices();
    return { ...services, service: services.tests };
}

describe("TestService — the controllers' trees", () => {
    it("diffs build the tree: add on three levels, a shallow update, a remove with the subtree", () => {
        const { service } = setup();
        const diffs: (readonly WireTestsDiffOp[])[] = [];
        service.onDidProcessDiff((diff) => diffs.push(diff));
        service.publishDiff([
            add("c", 1),
            add(testId("c", "f")),
            add(testId("c", "f", "s")),
            add(testId("c", "f", "s", "t")),
        ]);
        expect(testTree(service)).toEqual(["c [1]", "  f", "    s", "      t"]);
        expect(service.getNodeById(testId("c", "f"))?.controllerId).toBe("c");

        service.publishDiff([
            { op: 1, item: { extId: testId("c", "f", "s"), item: { label: "suite", busy: true } } },
            { op: 1, item: { extId: "c", expand: 3 } },
            { op: 1, item: { extId: "unknown", item: { label: "x" } } },
        ]);
        expect(testTree(service)).toEqual(["c [3]", "  f", "    suite", "      t"]);
        expect(service.getNodeById(testId("c", "f", "s"))?.item).toMatchObject({
            busy: true,
            extId: testId("c", "f", "s"),
        });

        service.publishDiff([
            { op: 3, itemId: testId("c", "f", "s") },
            { op: 3, itemId: "unknown" },
        ]);
        expect(testTree(service)).toEqual(["c [3]", "  f"]);
        expect(service.getNodeById(testId("c", "f", "s", "t"))).toBeUndefined();
        service.publishDiff([{ op: 3, itemId: "c" }]);
        expect(service.rootItems).toEqual([]);
        expect(service.getNodeById(testId("c", "f"))).toBeUndefined();
        expect(diffs).toHaveLength(4);
    });

    it("a test whose parent is unknown is dropped", () => {
        const { service } = setup();
        service.publishDiff([add(testId("c", "f"))]);
        expect(service.getNodeById(testId("c", "f"))).toBeUndefined();
        expect(service.rootItems).toEqual([]);
    });

    it("registering a controller counts it and its refresh capability; disposing drops its tests and only its own", () => {
        const { service, contextKeys } = setup();
        expect(contextKeys.get("testing.providerCount")).toBe(0);
        expect(contextKeys.get("testing.canRefresh")).toBe(false);
        expect(contextKeys.get("testing.isRefreshing")).toBe(false);
        const first = service.registerTestController(controller("a"));
        expect(contextKeys.get("testing.providerCount")).toBe(1);
        expect(contextKeys.get("testing.canRefresh")).toBe(false);
        service.registerTestController(controller("b", { canRefresh: true }));
        expect(contextKeys.get("testing.providerCount")).toBe(2);
        expect(contextKeys.get("testing.canRefresh")).toBe(true);
        service.publishDiff([add("a"), add(testId("a", "x")), add("b")]);
        const diffs: (readonly WireTestsDiffOp[])[] = [];
        service.onDidProcessDiff((diff) => diffs.push(diff));
        first.dispose();
        expect(testTree(service)).toEqual(["b"]);
        expect(diffs).toEqual([[{ op: 3, itemId: "a" }]]);
        expect(service.getTestController("a")).toBeUndefined();
        expect(contextKeys.get("testing.providerCount")).toBe(1);
    });

    it("an update changes only the fields it carries and recounts; the registration still drops it", () => {
        const { service, contextKeys } = setup();
        const registration = service.registerTestController(controller("a"));
        registration.update({ label: "A" });
        expect(service.getTestController("a")).toMatchObject({ label: "A", canRefresh: false });
        registration.update({ canRefresh: true });
        expect(service.getTestController("a")).toMatchObject({ label: "A", canRefresh: true });
        expect(contextKeys.get("testing.canRefresh")).toBe(true);
        registration.dispose();
        expect(service.getTestController("a")).toBeUndefined();
        expect(contextKeys.get("testing.canRefresh")).toBe(false);
    });

    it("a stale registration of a replaced id does not drop the new one", () => {
        const { service } = setup();
        const old = service.registerTestController(controller("a"));
        service.registerTestController(controller("a", { label: "fresh" }));
        old.dispose();
        expect(service.getTestController("a")?.label).toBe("fresh");
    });

    it("expandTest goes to the test's controller; infinite levels go as -1", async () => {
        const { service } = setup();
        const expandTest = vi.fn(() => Promise.resolve());
        service.registerTestController(controller("a", { expandTest }));
        await service.expandTest(testId("a", "f"), 2);
        await service.expandTest("a", Infinity);
        await service.expandTest(testId("zz", "f"), 1);
        expect(expandTest.mock.calls).toEqual([
            [testId("a", "f"), 2],
            ["a", -1],
        ]);
    });
});

describe("TestService — refresh", () => {
    function pending(): {
        readonly refreshTests: (token: ICancellationToken) => Promise<void>;
        readonly tokens: ICancellationToken[];
        finish(): void;
    } {
        const tokens: ICancellationToken[] = [];
        const finishers: (() => void)[] = [];
        return {
            tokens,
            refreshTests: (token) =>
                new Promise<void>((resolve) => {
                    tokens.push(token);
                    finishers.push(resolve);
                }),
            finish: () => {
                for (const finish of finishers) finish();
            },
        };
    }

    it("refreshes every controller, testing.isRefreshing holds until all have finished", async () => {
        const { service, contextKeys } = setup();
        const a = pending();
        const b = pending();
        service.registerTestController(controller("a", { canRefresh: true, refreshTests: a.refreshTests }));
        service.registerTestController(controller("b", { refreshTests: b.refreshTests }));
        const refreshing = service.refreshTests();
        expect(contextKeys.get("testing.isRefreshing")).toBe(true);
        expect(a.tokens).toHaveLength(1);
        expect(b.tokens).toHaveLength(1);
        a.finish();
        await Promise.resolve();
        expect(contextKeys.get("testing.isRefreshing")).toBe(true);
        b.finish();
        await refreshing;
        expect(contextKeys.get("testing.isRefreshing")).toBe(false);
        expect(a.tokens[0].isCancellationRequested).toBe(false);
    });

    it("one controller by id; two refreshes overlap until the last one ends", async () => {
        const { service, contextKeys } = setup();
        const a = pending();
        const b = pending();
        service.registerTestController(controller("a", { refreshTests: a.refreshTests }));
        service.registerTestController(controller("b", { refreshTests: b.refreshTests }));
        const first = service.refreshTests("a");
        const second = service.refreshTests("b");
        expect([a.tokens.length, b.tokens.length]).toEqual([1, 1]);
        a.finish();
        await first;
        expect(contextKeys.get("testing.isRefreshing")).toBe(true);
        b.finish();
        await second;
        expect(contextKeys.get("testing.isRefreshing")).toBe(false);
        await service.refreshTests("unknown");
    });

    it("cancel cancels the tokens in flight and clears testing.isRefreshing at once", async () => {
        const { service, contextKeys } = setup();
        const a = pending();
        service.registerTestController(controller("a", { refreshTests: a.refreshTests }));
        const refreshing = service.refreshTests();
        service.cancelRefreshTests();
        expect(a.tokens[0].isCancellationRequested).toBe(true);
        expect(contextKeys.get("testing.isRefreshing")).toBe(false);
        a.finish();
        await refreshing;
        expect(contextKeys.get("testing.isRefreshing")).toBe(false);
    });

    it("a failed refresh rejects and still clears testing.isRefreshing", async () => {
        const { service, contextKeys } = setup();
        service.registerTestController(controller("a", { refreshTests: () => Promise.reject(new Error("boom")) }));
        await expect(service.refreshTests()).rejects.toThrow("boom");
        expect(contextKeys.get("testing.isRefreshing")).toBe(false);
    });
});

describe("TestService — runs", () => {
    /** A controller whose `runTests` waits for `answer`; it records the requests. */
    function runner(id: string, cancel: ITestController["cancelTestRun"] = () => undefined) {
        const calls: { requests: readonly IWireStartControllerTests[]; token: ICancellationToken }[] = [];
        let answer: (answers: IWireRunControllerTestsResult[]) => void = () => undefined;
        let fail: (error: Error) => void = () => undefined;
        const registered = controller(id, {
            runTests: (requests, token) => {
                calls.push({ requests, token });
                return new Promise((resolve, reject) => {
                    answer = resolve;
                    fail = reject;
                });
            },
            cancelTestRun: cancel,
        });
        return {
            registered,
            calls,
            answer: (answers: IWireRunControllerTestsResult[] = [{}]) => {
                answer(answers);
            },
            fail: (error: Error) => {
                fail(error);
            },
        };
    }

    function runProfile(
        controllerId: string,
        profileId: number,
        fields: Partial<IWireTestRunProfile> = {},
    ): IWireTestRunProfile {
        return {
            controllerId,
            profileId,
            label: "Run",
            group: TestRunProfileBitset.Run,
            isDefault: true,
            tag: null,
            hasConfigurationHandler: false,
            supportsContinuousRun: false,
            ...fields,
        };
    }

    function tagged(extId: string, tags: string[]): WireTestsDiffOp {
        return { op: 0, item: { expand: 0, item: { ...wireItem(extId), tags } } };
    }

    it("the result is live before Save All and the requests; each controller gets its share with the excludes outside it", async () => {
        let saved = (): void => undefined;
        const services = makeTestingServices({
            saveAllBeforeTest: () =>
                new Promise<void>((resolve) => {
                    saved = resolve;
                }),
        });
        const { tests: service, results, profiles } = services;
        const a = runner("a");
        const b = runner("b");
        service.registerTestController(a.registered);
        service.registerTestController(b.registered);
        profiles.addProfile(runProfile("a", 1));
        profiles.addProfile(runProfile("b", 2));
        service.publishDiff([add("a"), add(testId("a", "x")), add(testId("a", "y")), add("b")]);
        const node = (id: string) => assertReturnsDefined(service.getNodeById(id));
        const running = service.runTests({ tests: [node("a"), node("b")], exclude: [node(testId("a", "y"))] });
        expect(results.results).toHaveLength(1);
        const [result] = results.results;
        expect(result.completedAt).toBeUndefined();
        expect(result.request).toEqual({
            targets: [
                { controllerId: "a", profileId: 1, testIds: ["a"] },
                { controllerId: "b", profileId: 2, testIds: ["b"] },
            ],
            group: TestRunProfileBitset.Run,
            exclude: [testId("a", "y")],
        });
        await Promise.resolve();
        expect(services.saves).toHaveLength(1);
        expect(a.calls).toEqual([]);
        saved();
        await vi.waitFor(() => {
            expect(b.calls).toHaveLength(1);
        });
        expect(a.calls[0].requests).toEqual([
            { runId: result.id, controllerId: "a", profileId: 1, testIds: ["a"], excludeExtIds: [testId("a", "y")] },
        ]);
        expect(b.calls[0].requests).toEqual([
            { runId: result.id, controllerId: "b", profileId: 2, testIds: ["b"], excludeExtIds: [testId("a", "y")] },
        ]);
        a.answer();
        await Promise.resolve();
        expect(result.completedAt).toBeUndefined();
        b.answer();
        await expect(running).resolves.toBe(result);
        expect(result.completedAt).toBeDefined();
        expect(services.errors).toEqual([]);
    });

    it("each test goes with its controller's first profile of the group that takes its tag; a test without one is not run", async () => {
        const { tests: service, results, profiles } = makeTestingServices();
        const a = runner("a");
        service.registerTestController(a.registered);
        profiles.addProfile(runProfile("a", 1, { label: "Unit", isDefault: false, tag: "a\0unit" }));
        profiles.addProfile(runProfile("a", 2, { label: "Debug", group: TestRunProfileBitset.Debug }));
        profiles.addProfile(runProfile("a", 3, { label: "Zeta", isDefault: false }));
        service.publishDiff([add("a"), tagged(testId("a", "u"), ["a\0unit"]), add(testId("a", "plain"))]);
        const nodes = ["a", testId("a", "u"), testId("a", "plain")].map((id) =>
            assertReturnsDefined(service.getNodeById(id)),
        );
        const running = service.runTests({ tests: nodes });
        // A root takes any tag: the first Run profile.
        expect(results.results[0].request.targets).toEqual([
            { controllerId: "a", profileId: 1, testIds: ["a", testId("a", "u")] },
            { controllerId: "a", profileId: 3, testIds: [testId("a", "plain")] },
        ]);
        await vi.waitFor(() => {
            expect(a.calls).toHaveLength(1);
        });
        // One request per controller with both profiles' shares.
        expect(a.calls[0].requests.map((request) => request.profileId)).toEqual([1, 3]);
        a.answer([{}, {}]);
        await running;
        const nothing = makeTestingServices();
        nothing.tests.publishDiff([add("z")]);
        await nothing.tests.runTests({ tests: [assertReturnsDefined(nothing.tests.getNodeById("z"))] });
        expect(nothing.results.results[0].request.targets).toEqual([]);
        expect(nothing.results.results[0].completedAt).toBeDefined();
    });

    it("a runHandler's error is a toast; an extension gone meanwhile or an unknown controller just ends its share", async () => {
        const services = makeTestingServices();
        const { tests: service } = services;
        const a = runner("a");
        const b = runner("b");
        service.registerTestController(a.registered);
        service.registerTestController(b.registered);
        const running = service.runResolvedTests({
            targets: [
                { controllerId: "a", profileId: 1, testIds: ["a"] },
                { controllerId: "a", profileId: 2, testIds: ["a"] },
                { controllerId: "b", profileId: 1, testIds: ["b"] },
                { controllerId: "gone", profileId: 1, testIds: ["gone"] },
            ],
            group: TestRunProfileBitset.Run,
        });
        await vi.waitFor(() => {
            expect(b.calls).toHaveLength(1);
        });
        a.answer([{ error: "Error: no vitest" }, { error: "Error: again" }]);
        b.fail(new Error("Extension host exited"));
        const result = await running;
        expect(result.completedAt).toBeDefined();
        expect(services.errors).toEqual(["An error occurred attempting to run tests: Error: no vitest Error: again"]);
    });

    it("cancel goes once to each extension host and cancels the token of a run the core started; without an id — every live run", async () => {
        const { tests: service, results } = makeTestingServices();
        const cancels: string[] = [];
        const shared = (runId: string, taskId?: string): void => {
            cancels.push(taskId === undefined ? runId : `${runId}/${taskId}`);
        };
        const a = runner("a", shared);
        const b = runner("b", shared);
        const other = runner("other", (runId) => {
            cancels.push(`other:${runId}`);
        });
        for (const r of [a, b, other]) service.registerTestController(r.registered);
        const first = service.runResolvedTests({
            targets: [{ controllerId: "a", profileId: 1, testIds: ["a"] }],
            group: TestRunProfileBitset.Run,
        });
        await vi.waitFor(() => {
            expect(a.calls).toHaveLength(1);
        });
        const [live] = results.results;
        service.cancelTestRun(live.id, "task");
        expect(a.calls[0].token.isCancellationRequested).toBe(false);
        service.cancelTestRun(live.id);
        expect(a.calls[0].token.isCancellationRequested).toBe(true);
        expect(cancels).toEqual([`${live.id}/task`, `other:${live.id}`, live.id, `other:${live.id}`]);
        cancels.length = 0;
        const ext = results.createExtensionLiveResult(
            {
                runId: "ext",
                controllerId: "b",
                include: ["b"],
                exclude: [],
                profileId: null,
                preserveFocus: true,
                persist: true,
                continuous: false,
            },
            undefined,
        );
        service.cancelTestRun();
        expect(cancels).toEqual(["ext", "other:ext", live.id, `other:${live.id}`]);
        a.answer();
        await first;
        ext.markComplete();
        cancels.length = 0;
        service.cancelTestRun();
        expect(cancels).toEqual([]);
    });
});
