import { describe, expect, it, vi } from "vitest";

import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IWireTestItem, WireTestsDiffOp } from "../../../api/common/testingWireTypes.ts";

import { type ITestController, TestService } from "./testService.ts";

const ID = (...path: string[]): string => path.join("\0");

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
        ...overrides,
    };
}

function setup() {
    const contextKeys = new ContextKeyService();
    const service = new TestService(contextKeys);
    return { contextKeys, service };
}

/** The tree as `label` lines, children indented. */
function tree(service: TestService): string[] {
    const lines: string[] = [];
    const walk = (id: string, depth: number): void => {
        const node = service.getNodeById(id);
        if (node === undefined) return;
        lines.push(`${"  ".repeat(depth)}${node.item.label}${node.expand === 0 ? "" : ` [${node.expand}]`}`);
        for (const child of node.children) walk(child, depth + 1);
    };
    for (const root of service.rootItems) walk(root.item.extId, 0);
    return lines;
}

describe("TestService — the controllers' trees", () => {
    it("diffs build the tree: add on three levels, a shallow update, a remove with the subtree", () => {
        const { service } = setup();
        const diffs: (readonly WireTestsDiffOp[])[] = [];
        service.onDidProcessDiff((diff) => diffs.push(diff));
        service.publishDiff([add("c", 1), add(ID("c", "f")), add(ID("c", "f", "s")), add(ID("c", "f", "s", "t"))]);
        expect(tree(service)).toEqual(["c [1]", "  f", "    s", "      t"]);
        expect(service.getNodeById(ID("c", "f"))?.controllerId).toBe("c");

        service.publishDiff([
            { op: 1, item: { extId: ID("c", "f", "s"), item: { label: "suite", busy: true } } },
            { op: 1, item: { extId: "c", expand: 3 } },
            { op: 1, item: { extId: "unknown", item: { label: "x" } } },
        ]);
        expect(tree(service)).toEqual(["c [3]", "  f", "    suite", "      t"]);
        expect(service.getNodeById(ID("c", "f", "s"))?.item).toMatchObject({ busy: true, extId: ID("c", "f", "s") });

        service.publishDiff([
            { op: 3, itemId: ID("c", "f", "s") },
            { op: 3, itemId: "unknown" },
        ]);
        expect(tree(service)).toEqual(["c [3]", "  f"]);
        expect(service.getNodeById(ID("c", "f", "s", "t"))).toBeUndefined();
        service.publishDiff([{ op: 3, itemId: "c" }]);
        expect(service.rootItems).toEqual([]);
        expect(service.getNodeById(ID("c", "f"))).toBeUndefined();
        expect(diffs).toHaveLength(4);
    });

    it("a test whose parent is unknown is dropped", () => {
        const { service } = setup();
        service.publishDiff([add(ID("c", "f"))]);
        expect(service.getNodeById(ID("c", "f"))).toBeUndefined();
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
        service.publishDiff([add("a"), add(ID("a", "x")), add("b")]);
        const diffs: (readonly WireTestsDiffOp[])[] = [];
        service.onDidProcessDiff((diff) => diffs.push(diff));
        first.dispose();
        expect(tree(service)).toEqual(["b"]);
        expect(diffs).toEqual([[{ op: 3, itemId: "a" }]]);
        expect(service.getTestController("a")).toBeUndefined();
        expect(contextKeys.get("testing.providerCount")).toBe(1);
    });

    it("an update replaces the controller's fields and recounts; the registration still drops it; an unknown id is ignored", () => {
        const { service, contextKeys } = setup();
        const registration = service.registerTestController(controller("a"));
        service.updateTestController(controller("a", { label: "A", canRefresh: true }));
        expect(service.getTestController("a")?.label).toBe("A");
        expect(contextKeys.get("testing.canRefresh")).toBe(true);
        service.updateTestController(controller("z", { canRefresh: true }));
        expect(service.getTestController("z")).toBeUndefined();
        registration.dispose();
        expect(service.getTestController("a")).toBeUndefined();
        expect(contextKeys.get("testing.canRefresh")).toBe(false);
    });

    it("expandTest goes to the test's controller; infinite levels go as -1", async () => {
        const { service } = setup();
        const expandTest = vi.fn(() => Promise.resolve());
        service.registerTestController(controller("a", { expandTest }));
        await service.expandTest(ID("a", "f"), 2);
        await service.expandTest("a", Infinity);
        await service.expandTest(ID("zz", "f"), 1);
        expect(expandTest.mock.calls).toEqual([
            [ID("a", "f"), 2],
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
