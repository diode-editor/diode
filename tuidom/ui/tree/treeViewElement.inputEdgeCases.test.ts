import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { TUIMouseEvent, type TUIMouseEventType, type WheelDirection } from "../../dom/events/tuiMouseEvent.ts";

import type { ITreeDataProvider, ITreeItem } from "./iTreeDataProvider.ts";
import { TreeViewElement } from "./treeViewElement.ts";

// ─── Test data ───

interface TestNode {
    id: string;
    label: string;
    children?: TestNode[];
    // When set, overrides the "has children" heuristic for collapsibility.
    // Lets us model a node that *claims* to be expandable but yields no children.
    collapsible?: boolean;
}

function createProvider(roots: TestNode[]): ITreeDataProvider<TestNode> {
    return {
        getTreeItem(element: TestNode): ITreeItem {
            return {
                label: element.label,
                collapsible: element.collapsible ?? (element.children?.length ?? 0) > 0,
            };
        },
        getChildren(element?: TestNode): TestNode[] {
            if (!element) return roots;
            return element.children ?? [];
        },
        getKey(element: TestNode): string {
            return element.id;
        },
    };
}

function createTree(
    roots: TestNode[],
    viewportSize: Size = new Size(40, 10),
): { tree: TreeViewElement<TestNode>; app: TestApp; provider: ITreeDataProvider<TestNode> } {
    const provider = createProvider(roots);
    const tree = new TreeViewElement(provider);
    const app = TestApp.createWithContent(tree, viewportSize);
    tree.localPosition = new Offset(0, 0);
    tree.performLayout(BoxConstraints.tight(viewportSize));
    tree.focus();
    return { tree, app, provider };
}

function mouseEvent(
    type: TUIMouseEventType,
    opts: {
        button?: "left" | "right";
        localX?: number;
        localY?: number;
        wheelDirection?: WheelDirection;
    },
): TUIMouseEvent {
    const localX = opts.localX ?? 0;
    const localY = opts.localY ?? 0;
    return new TUIMouseEvent(type, {
        button: opts.button ?? "left",
        screenX: localX,
        screenY: localY,
        localX,
        localY,
        wheelDirection: opts.wheelDirection,
    });
}

const FLAT_TREE: TestNode[] = [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
    { id: "c", label: "Gamma" },
];

// ─── Tests ───

describe("TreeViewElement input edge cases", () => {
    describe("keypress with no binding", () => {
        it("ignores an unbound key without changing selection", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            app.render();

            const onSelect = vi.fn();
            const onActivate = vi.fn();
            tree.onSelect = onSelect;
            tree.onActivate = onActivate;

            // A key the switch does not handle hits the default branch.
            app.sendKey("x");

            expect(onSelect).not.toHaveBeenCalled();
            expect(onActivate).not.toHaveBeenCalled();
        });
    });

    describe("ArrowRight on a non-expandable cursor", () => {
        it("does nothing on a leaf row", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            app.render();

            const onSelect = vi.fn();
            tree.onSelect = onSelect;

            // Cursor is on a leaf (Alpha) — ArrowRight has nothing to expand
            // and no child to move to.
            app.sendKey("ArrowRight");
            await Promise.resolve();

            expect(onSelect).not.toHaveBeenCalled();
            expect(tree.contentHeight).toBe(3);
        });
    });

    describe("ArrowRight on an expanded node that yields no children", () => {
        it("does not move when the expanded node is the last row", async () => {
            // collapsible:true but getChildren returns [] → expands to nothing.
            const roots: TestNode[] = [{ id: "empty", label: "empty", collapsible: true }];
            const { tree, app } = createTree(roots);
            await tree.refresh();
            await tree.toggleExpand(roots[0]); // expanded, but no children appear
            app.render();
            expect(tree.contentHeight).toBe(1);

            const onSelect = vi.fn();
            tree.onSelect = onSelect;

            // Already expanded + selectedIndex + 1 is past the end of the list.
            app.sendKey("ArrowRight");
            await Promise.resolve();

            expect(onSelect).not.toHaveBeenCalled();
        });

        it("does not move when the next row is a sibling at the same depth", async () => {
            const roots: TestNode[] = [
                { id: "first", label: "first", collapsible: true },
                { id: "second", label: "second", collapsible: true },
            ];
            const { tree, app } = createTree(roots);
            await tree.refresh();
            await tree.toggleExpand(roots[0]); // expands to nothing; "second" is next
            app.render();
            expect(tree.contentHeight).toBe(2);

            const onSelect = vi.fn();
            tree.onSelect = onSelect;

            // Already expanded; next row "second" is a sibling (depth 0), not a child.
            app.sendKey("ArrowRight");
            await Promise.resolve();

            expect(onSelect).not.toHaveBeenCalled();
        });
    });

    describe("ArrowLeft on a root leaf", () => {
        it("does nothing when there is no parent to move to", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            app.render();

            const onSelect = vi.fn();
            tree.onSelect = onSelect;

            // Cursor is on a root leaf: not expandable, parentKey === null.
            app.sendKey("ArrowLeft");
            await Promise.resolve();

            expect(onSelect).not.toHaveBeenCalled();
        });
    });

    describe("Space on a non-expandable cursor", () => {
        it("does not toggle anything on a leaf row", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            app.render();

            const onExpandedChanged = vi.fn();
            tree.onExpandedChanged = onExpandedChanged;

            app.sendKey(" ");
            await Promise.resolve();

            expect(onExpandedChanged).not.toHaveBeenCalled();
            expect(tree.contentHeight).toBe(3);
        });
    });

    describe("navigation on an empty tree", () => {
        it("ArrowDown is a no-op when there are no rows", async () => {
            const { tree, app } = createTree([]);
            await tree.refresh();
            app.render();
            expect(tree.contentHeight).toBe(0);

            const onSelect = vi.fn();
            tree.onSelect = onSelect;

            // setSelectedIndex clamps to -1 (empty list) and bails out.
            app.sendKey("ArrowDown");

            expect(onSelect).not.toHaveBeenCalled();
        });
    });

    describe("toggleExpand before the root has loaded", () => {
        it("leaves the flat list empty when no root children are cached yet", async () => {
            const roots: TestNode[] = [{ id: "dir", label: "dir", children: [{ id: "f", label: "f" }] }];
            const { tree } = createTree(roots);

            // No refresh() yet → __root__ is not in the cache. Expanding rebuilds
            // the flat list, which must bail out without any root children.
            await tree.toggleExpand(roots[0]);

            expect(tree.contentHeight).toBe(0);
        });
    });

    describe("refresh after the selected node disappears", () => {
        it("resets the cursor to the top when the previous selection is gone", async () => {
            const roots: TestNode[] = [
                { id: "a", label: "Alpha" },
                { id: "b", label: "Beta" },
                { id: "c", label: "Gamma" },
            ];
            const { tree, app } = createTree(roots);
            await tree.refresh();
            app.render();

            // Select Beta (index 1).
            app.sendKey("ArrowDown");

            // Remove Beta, then full refresh — its key can no longer be restored.
            roots.splice(1, 1);
            await tree.refresh();

            const onSelect = vi.fn();
            tree.onSelect = onSelect;

            // Cursor was reset to index 0 (Alpha); ArrowDown now selects Gamma.
            app.sendKey("ArrowDown");
            expect(onSelect).toHaveBeenCalledWith(roots[1]); // Gamma, now at index 1
        });
    });

    describe("mousemove over the already-hovered row", () => {
        it("does not re-mark dirty when the hovered index is unchanged", async () => {
            const roots: TestNode[] = [
                { id: "a", label: "Alpha" },
                { id: "b", label: "Beta" },
            ];
            const { tree } = createTree(roots, new Size(20, 5));
            await tree.refresh();

            // First move establishes the hover on row 1.
            tree.dispatchEvent(mouseEvent("mousemove", { localX: 3, localY: 1 }));

            const markDirty = vi.spyOn(tree, "markDirty");

            // Second move over the same row must be a no-op (same hovered index).
            tree.dispatchEvent(mouseEvent("mousemove", { localX: 5, localY: 1 }));

            expect(markDirty).not.toHaveBeenCalled();
        });
    });

    describe("wheel with a non-vertical direction", () => {
        it("does not scroll on a horizontal wheel event", async () => {
            const items: TestNode[] = Array.from({ length: 40 }, (_, i) => ({
                id: `n-${String(i)}`,
                label: `Item ${String(i)}`,
            }));
            const { tree } = createTree(items, new Size(20, 5));
            await tree.refresh();
            expect(tree.scrollTop).toBe(0);

            tree.dispatchEvent(mouseEvent("wheel", { localX: 1, localY: 1, wheelDirection: "left" }));

            expect(tree.scrollTop).toBe(0);
        });
    });
});
