import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscodeTypes from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { TEST_DIFF_DEBOUNCE_MS } from "./extHostTestItemCollection.ts";
import type { WireTestsDiffOp } from "./testingWireTypes.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

const ID = (...path: string[]): string => path.join("\0");

function setup() {
    const stub = makeStubRpc();
    const { namespace: vscode } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());
    const controller = vscode.tests.createTestController("ctrl", "Ctrl");
    /** The diffs published since the last call, after the debounce. */
    const flush = (): WireTestsDiffOp[] => {
        vi.advanceTimersByTime(TEST_DIFF_DEBOUNCE_MS);
        const published = stub.notifies.filter((n) => n.method === "testing.publishDiff");
        stub.notifies.length = 0;
        return published.flatMap((n) => (n.params as { diff: WireTestsDiffOp[] }).diff);
    };
    return { stub, vscode, controller, flush };
}

// The extension's tree reaches the host as upstream diffs: Add (0), Update (1), Remove (3).
describe("vscode.tests — the controller's tree as diffs", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("[api:tests.createTestController] the controller root comes first, after the 200 ms batch window", () => {
        const { stub, flush } = setup();
        vi.advanceTimersByTime(TEST_DIFF_DEBOUNCE_MS - 1);
        expect(stub.notifies.filter((n) => n.method === "testing.publishDiff")).toEqual([]);
        expect(flush()).toEqual([
            {
                op: 0,
                item: {
                    expand: 0,
                    item: {
                        extId: "ctrl",
                        label: "Ctrl",
                        tags: [],
                        busy: false,
                        uri: undefined,
                        range: null,
                        description: null,
                        error: null,
                        sortText: null,
                    },
                },
            },
        ]);
    });

    it("[api:tests.createTestController] three levels added at once go in one batch with full ids and fields", () => {
        const { vscode, controller, flush } = setup();
        flush();
        const file = controller.createTestItem("file", "math.test.ts", vscode.Uri.file("/w/math.test.ts"));
        const suite = controller.createTestItem("suite", "math");
        const test = controller.createTestItem("adds", "adds");
        test.range = new vscode.Range(2, 4, 2, 20);
        test.tags = [new vscode.TestTag("unit")];
        test.description = "desc";
        test.sortText = "a";
        test.error = new vscode.MarkdownString("**bad**");
        suite.children.add(test);
        file.children.add(suite);
        controller.items.add(file);
        const ops = flush();
        expect(ops.map((op) => (op.op === 0 ? op.item.item.extId : op))).toEqual([
            ID("ctrl", "file"),
            ID("ctrl", "file", "suite"),
            ID("ctrl", "file", "suite", "adds"),
        ]);
        expect(ops[0]).toMatchObject({ item: { item: { uri: "file:///w/math.test.ts", label: "math.test.ts" } } });
        expect(ops[2]).toMatchObject({
            item: {
                item: {
                    range: { start: { line: 2, character: 4 }, end: { line: 2, character: 20 } },
                    tags: [ID("ctrl", "unit")],
                    description: "desc",
                    sortText: "a",
                    error: "**bad**",
                },
            },
        });
        expect(test.parent).toBe(suite);
        expect(file.parent).toBeUndefined();
    });

    it("[api:tests.createTestController] field edits of a known test merge into one update; a same value sends nothing", () => {
        const { vscode, controller, flush } = setup();
        const item = controller.createTestItem("a", "A");
        controller.items.add(item);
        flush();
        item.label = "A2";
        item.busy = true;
        item.description = "d";
        item.sortText = "s";
        item.error = "e";
        item.range = new vscode.Range(0, 0, 1, 0);
        item.tags = [new vscode.TestTag("t")];
        item.label = "A2";
        item.range = new vscode.Range(0, 0, 1, 0);
        item.tags = [new vscode.TestTag("t")];
        expect(flush()).toEqual([
            {
                op: 1,
                item: {
                    extId: ID("ctrl", "a"),
                    item: {
                        label: "A2",
                        busy: true,
                        description: "d",
                        sortText: "s",
                        error: "e",
                        range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
                        tags: [ID("ctrl", "t")],
                    },
                },
            },
        ]);
        item.description = undefined;
        item.sortText = undefined;
        item.error = undefined;
        item.range = undefined;
        item.busy = false;
        expect(flush()).toEqual([
            {
                op: 1,
                item: {
                    extId: ID("ctrl", "a"),
                    item: { description: null, sortText: null, error: null, range: null, busy: false },
                },
            },
        ]);
    });

    it("an edit of a test added in the same batch lands in its Add", () => {
        const { controller, flush } = setup();
        flush();
        const item = controller.createTestItem("a", "A");
        controller.items.add(item);
        item.label = "A2";
        const ops = flush();
        expect(ops).toHaveLength(1);
        expect(ops[0]).toMatchObject({ op: 0, item: { item: { label: "A2" } } });
    });

    it("edits of two tests in turn stay two updates", () => {
        const { controller, flush } = setup();
        const a = controller.createTestItem("a", "A");
        const b = controller.createTestItem("b", "B");
        controller.items.replace([a, b]);
        flush();
        a.label = "A2";
        b.label = "B2";
        a.busy = true;
        expect(flush().map((op) => (op.op === 1 ? op.item.extId : op))).toEqual([
            ID("ctrl", "a"),
            ID("ctrl", "b"),
            ID("ctrl", "a"),
        ]);
    });

    it("[api:tests.createTestController] delete removes the test with its subtree in one op; the detached tree is silent", () => {
        const { controller, flush } = setup();
        const file = controller.createTestItem("file", "F");
        const child = controller.createTestItem("c", "C");
        file.children.add(child);
        controller.items.add(file);
        flush();
        controller.items.delete("file");
        controller.items.delete("file");
        expect(flush()).toEqual([{ op: 3, itemId: ID("ctrl", "file") }]);
        child.label = "after";
        file.children.delete("c");
        expect(flush()).toEqual([]);
    });

    it("replace upserts the new set and removes the rest; a duplicate, a foreign or a hand-made item throws", () => {
        const { vscode, controller, flush } = setup();
        const a = controller.createTestItem("a", "A");
        const b = controller.createTestItem("b", "B");
        controller.items.replace([a, b]);
        flush();
        const c = controller.createTestItem("c", "C");
        controller.items.replace([b, c]);
        expect(flush().map((op) => (op.op === 0 ? `add ${op.item.item.extId}` : op))).toEqual([
            `add ${ID("ctrl", "c")}`,
            { op: 3, itemId: ID("ctrl", "a") },
        ]);
        expect([...controller.items].map(([id]) => id)).toEqual(["b", "c"]);

        expect(() => {
            controller.items.replace([c, controller.createTestItem("c", "again")]);
        }).toThrow("Attempted to insert a duplicate test item ID c");
        const other = vscode.tests.createTestController("other", "Other");
        expect(() => {
            controller.items.replace([other.createTestItem("x", "X")]);
        }).toThrow(
            'TestItem with ID "x" is from controller "other" and cannot be added as a child of an item from controller "ctrl".',
        );
        const fake = { id: "fake" } as unknown as vscodeTypes.TestItem;
        expect(() => {
            controller.items.add(fake);
        }).toThrow('TestItem with ID "fake" is invalid. Make sure to create it from the createTestItem method.');
        expect(() => {
            controller.items.replace([fake]);
        }).toThrow('TestItem with ID "fake" is invalid.');
        expect(() => controller.createTestItem("a\0b", "bad")).toThrow("Test IDs may not include");
        expect([...controller.items].map(([id]) => id)).toEqual(["b", "c"]);
    });

    it("a new instance under a known id sends the changed fields, drops its orphaned children, keeps the rest", () => {
        const { controller, flush } = setup();
        const old = controller.createTestItem("a", "A");
        old.children.add(controller.createTestItem("keep", "K"));
        old.children.add(controller.createTestItem("gone", "G"));
        controller.items.add(old);
        flush();
        const next = controller.createTestItem("a", "A2");
        next.children.add(controller.createTestItem("keep", "K"));
        controller.items.add(next);
        expect(flush()).toEqual([
            { op: 1, item: { extId: ID("ctrl", "a"), item: { label: "A2" } } },
            { op: 3, itemId: ID("ctrl", "a", "gone") },
        ]);
        old.label = "stale";
        next.label = "A3";
        expect(flush()).toEqual([{ op: 1, item: { extId: ID("ctrl", "a"), item: { label: "A3" } } }]);
    });

    it("a new instance under a known id with another uri is removed and added anew", () => {
        const { vscode, controller, flush } = setup();
        controller.items.add(controller.createTestItem("a", "A", vscode.Uri.file("/w/a.ts")));
        flush();
        controller.items.add(controller.createTestItem("a", "A", vscode.Uri.file("/w/b.ts")));
        const ops = flush();
        expect(ops[0]).toEqual({ op: 3, itemId: ID("ctrl", "a") });
        expect(ops[1]).toMatchObject({ op: 0, item: { item: { extId: ID("ctrl", "a"), uri: "file:///w/b.ts" } } });
    });

    it("an item moved to another parent leaves the old one", () => {
        const { controller, flush } = setup();
        const left = controller.createTestItem("l", "L");
        const right = controller.createTestItem("r", "R");
        const item = controller.createTestItem("x", "X");
        left.children.add(item);
        controller.items.replace([left, right]);
        flush();
        right.children.add(item);
        expect(left.children.get("x")).toBeUndefined();
        expect(item.parent).toBe(right);
        expect(flush().map((op) => (op.op === 0 ? `add ${op.item.item.extId}` : op))).toEqual([
            { op: 3, itemId: ID("ctrl", "l", "x") },
            `add ${ID("ctrl", "r", "x")}`,
        ]);
        right.children.add(item);
        expect(flush()).toEqual([]);
    });

    it("the controller label renames the root", () => {
        const { stub, controller, flush } = setup();
        flush();
        controller.label = "Renamed";
        expect(controller.label).toBe("Renamed");
        expect(stub.notifies).toContainEqual({
            method: "testing.updateController",
            params: { controllerId: "ctrl", label: "Renamed" },
        });
        expect(flush()).toEqual([{ op: 1, item: { extId: "ctrl", item: { label: "Renamed" } } }]);
    });

    it("dispose drops the queued diff and stops the tree", () => {
        const { controller, flush } = setup();
        const item = controller.createTestItem("a", "A");
        controller.items.add(item);
        controller.dispose();
        item.label = "after";
        expect(flush()).toEqual([]);
    });
});
