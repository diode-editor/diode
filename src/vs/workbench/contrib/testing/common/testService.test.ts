import { describe, expect, it, vi } from "vitest";

import { testId, testTree } from "../../../../../TestUtils/testTree.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { makeTestingServices } from "../../../../../TestUtils/testingServices.ts";
import type { IWireTestItem, WireTestsDiffOp } from "../../../api/common/testingWireTypes.ts";

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
