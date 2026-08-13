import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";

import type { ITreeDataProvider, ITreeItem } from "./iTreeDataProvider.ts";
import { TreeViewElement } from "./treeViewElement.ts";

// ─── Test data ───

interface TestNode {
    id: string;
    label: string;
    children?: TestNode[];
    icon?: string;
    iconColor?: number;
}

function createProvider(roots: TestNode[]): ITreeDataProvider<TestNode> {
    return {
        getTreeItem(element: TestNode): ITreeItem {
            return {
                label: element.label,
                icon: element.icon,
                iconColor: element.iconColor,
                collapsible: (element.children?.length ?? 0) > 0,
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

const FLAT_TREE: TestNode[] = [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
    { id: "c", label: "Gamma" },
];

const NESTED_TREE: TestNode[] = [
    {
        id: "src",
        label: "src",
        children: [
            {
                id: "src/utils",
                label: "utils",
                children: [{ id: "src/utils/helper.ts", label: "helper.ts" }],
            },
            { id: "src/main.ts", label: "main.ts" },
        ],
    },
    { id: "README.md", label: "README.md" },
];

function createTree(
    roots: TestNode[],
    viewportSize: Size = new Size(40, 10),
): { tree: TreeViewElement<TestNode>; app: TestApp; provider: ITreeDataProvider<TestNode> } {
    const provider = createProvider(roots);
    const tree = new TreeViewElement(provider);
    const app = TestApp.createWithContent(tree, viewportSize);
    tree.focus();
    return { tree, app, provider };
}

// ─── Tests ───

describe("TreeViewElement", () => {
    describe("refresh", () => {
        it("loads root children on refresh", async () => {
            const { tree } = createTree(FLAT_TREE);
            await tree.refresh();
            expect(tree.contentHeight).toBe(3);
        });

        it("starts empty before refresh", () => {
            const { tree } = createTree(FLAT_TREE);
            expect(tree.contentHeight).toBe(0);
        });

        it("recalculates content width after refresh", async () => {
            const { tree } = createTree(FLAT_TREE);
            await tree.refresh();
            // "  Alpha" = space + " " + "Alpha" => 2 + 5 = 7
            expect(tree.contentWidth).toBeGreaterThan(0);
        });
    });

    describe("toggleExpand", () => {
        it("expands a collapsible node and shows children", async () => {
            const { tree } = createTree(NESTED_TREE);
            await tree.refresh();
            // Initially: src, README.md = 2 items
            expect(tree.contentHeight).toBe(2);

            await tree.toggleExpand(NESTED_TREE[0]);
            // src expanded: src, utils, main.ts, README.md = 4
            expect(tree.contentHeight).toBe(4);
        });

        it("collapses an expanded node", async () => {
            const { tree } = createTree(NESTED_TREE);
            await tree.refresh();

            await tree.toggleExpand(NESTED_TREE[0]);
            expect(tree.contentHeight).toBe(4);

            await tree.toggleExpand(NESTED_TREE[0]);
            expect(tree.contentHeight).toBe(2);
        });

        it("fires onExpandedChanged with true when expanding", async () => {
            const { tree } = createTree(NESTED_TREE);
            await tree.refresh();

            const callback = vi.fn();
            tree.onExpandedChanged = callback;

            await tree.toggleExpand(NESTED_TREE[0]);
            expect(callback).toHaveBeenCalledWith(NESTED_TREE[0], true);
        });

        it("fires onExpandedChanged with false when collapsing", async () => {
            const { tree } = createTree(NESTED_TREE);
            await tree.refresh();
            await tree.toggleExpand(NESTED_TREE[0]);

            const callback = vi.fn();
            tree.onExpandedChanged = callback;

            await tree.toggleExpand(NESTED_TREE[0]);
            expect(callback).toHaveBeenCalledWith(NESTED_TREE[0], false);
        });

        it("caches children after first expand", async () => {
            const getChildrenSpy = vi.fn((element?: TestNode) => {
                if (!element) return NESTED_TREE;
                return element.children ?? [];
            });
            const provider: ITreeDataProvider<TestNode> = {
                getTreeItem: (e) => ({ label: e.label, collapsible: (e.children?.length ?? 0) > 0 }),
                getChildren: getChildrenSpy,
                getKey: (e) => e.id,
            };
            const tree = new TreeViewElement(provider);
            TestApp.createWithContent(tree, new Size(40, 10));
            await tree.refresh();

            getChildrenSpy.mockClear();

            // First expand — calls getChildren
            await tree.toggleExpand(NESTED_TREE[0]);
            expect(getChildrenSpy).toHaveBeenCalledTimes(1);

            // Collapse
            await tree.toggleExpand(NESTED_TREE[0]);
            getChildrenSpy.mockClear();

            // Re-expand — uses cache, no call
            await tree.toggleExpand(NESTED_TREE[0]);
            expect(getChildrenSpy).not.toHaveBeenCalled();
        });

        it("deep-expands nested nodes", async () => {
            const { tree } = createTree(NESTED_TREE);
            await tree.refresh();

            await tree.toggleExpand(NESTED_TREE[0]); // expand src
            const utils = NESTED_TREE[0].children![0];
            await tree.toggleExpand(utils); // expand utils

            // src, utils, helper.ts, main.ts, README.md = 5
            expect(tree.contentHeight).toBe(5);
        });
    });

    describe("keyboard navigation", () => {
        it("moves selection down with ArrowDown", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            app.render();

            const selectSpy = vi.fn();
            tree.onSelect = selectSpy;

            app.sendKey("ArrowDown");
            expect(selectSpy).toHaveBeenCalledWith(FLAT_TREE[1]);
        });

        it("moves selection up with ArrowUp", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            app.render();

            // Move down first, then up
            app.sendKey("ArrowDown");
            app.sendKey("ArrowDown");

            const selectSpy = vi.fn();
            tree.onSelect = selectSpy;

            app.sendKey("ArrowUp");
            expect(selectSpy).toHaveBeenCalledWith(FLAT_TREE[1]);
        });

        it("clamps selection at top boundary", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            app.render();

            const selectSpy = vi.fn();
            tree.onSelect = selectSpy;

            app.sendKey("ArrowUp");
            // Should still select first item (index 0)
            expect(selectSpy).toHaveBeenCalledWith(FLAT_TREE[0]);
        });

        it("clamps selection at bottom boundary", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            app.render();

            const selectSpy = vi.fn();
            tree.onSelect = selectSpy;

            // Move beyond last
            app.sendKey("ArrowDown");
            app.sendKey("ArrowDown");
            app.sendKey("ArrowDown");
            app.sendKey("ArrowDown");

            // Last call should be with Gamma (index 2)
            expect(selectSpy).toHaveBeenLastCalledWith(FLAT_TREE[2]);
        });

        it("expands collapsible node with ArrowRight", async () => {
            const { tree, app } = createTree(NESTED_TREE);
            await tree.refresh();
            app.render();

            // Selection starts at src (collapsible)
            app.sendKey("ArrowRight");
            // Need to wait for async expand
            await new Promise((r) => setTimeout(r, 10));

            expect(tree.contentHeight).toBe(4); // expanded
        });

        it("moves to first child with ArrowRight on already expanded node", async () => {
            const { tree, app } = createTree(NESTED_TREE);
            await tree.refresh();
            await tree.toggleExpand(NESTED_TREE[0]);
            app.render();

            const selectSpy = vi.fn();
            tree.onSelect = selectSpy;

            // ArrowRight on already-expanded src → move to first child (utils)
            app.sendKey("ArrowRight");
            await new Promise((r) => setTimeout(r, 10));

            expect(selectSpy).toHaveBeenCalledWith(NESTED_TREE[0].children![0]);
        });

        it("collapses expanded node with ArrowLeft", async () => {
            const { tree, app } = createTree(NESTED_TREE);
            await tree.refresh();
            await tree.toggleExpand(NESTED_TREE[0]);
            app.render();

            expect(tree.contentHeight).toBe(4);

            app.sendKey("ArrowLeft");
            await new Promise((r) => setTimeout(r, 10));

            expect(tree.contentHeight).toBe(2); // collapsed
        });

        it("moves to parent with ArrowLeft on leaf", async () => {
            const { tree, app } = createTree(NESTED_TREE);
            await tree.refresh();
            await tree.toggleExpand(NESTED_TREE[0]);
            app.render();

            // Move to "utils" (child of src)
            app.sendKey("ArrowDown");

            const selectSpy = vi.fn();
            tree.onSelect = selectSpy;

            app.sendKey("ArrowLeft");
            await new Promise((r) => setTimeout(r, 10));

            // Should go back to parent "src"
            expect(selectSpy).toHaveBeenCalledWith(NESTED_TREE[0]);
        });

        it("fires onActivate with Enter", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            app.render();

            const activateSpy = vi.fn();
            tree.onActivate = activateSpy;

            app.sendKey("Enter");
            expect(activateSpy).toHaveBeenCalledWith(FLAT_TREE[0]);
        });

        it("toggles expand with Space on collapsible", async () => {
            const { tree, app } = createTree(NESTED_TREE);
            await tree.refresh();
            app.render();

            app.sendKey(" ");
            await new Promise((r) => setTimeout(r, 10));

            expect(tree.contentHeight).toBe(4); // expanded
        });
    });

    describe("scrolling", () => {
        it("auto-scrolls down when selection goes below viewport", async () => {
            const shortTree: TestNode[] = [];
            for (let i = 0; i < 20; i++) {
                shortTree.push({ id: `item-${String(i)}`, label: `Item ${String(i)}` });
            }
            const { tree, app } = createTree(shortTree, new Size(40, 5));
            await tree.refresh();
            app.render();

            // Move selection past viewport
            for (let i = 0; i < 7; i++) {
                app.sendKey("ArrowDown");
            }

            expect(tree.scrollTop).toBeGreaterThan(0);
        });

        it("auto-scrolls up when selection goes above viewport", async () => {
            const items: TestNode[] = [];
            for (let i = 0; i < 20; i++) {
                items.push({ id: `item-${String(i)}`, label: `Item ${String(i)}` });
            }
            const { tree, app } = createTree(items, new Size(40, 5));
            await tree.refresh();
            tree.scrollTo(0, 10);
            app.render();

            // Selection is at 0, viewport starts at 10
            // ArrowDown won't scroll up, but if we set selection to something visible first...
            // Actually, after scrollTo(0, 10), selectedIndex is still 0 which is above viewport
            // pressing ArrowDown should re-select item 1 and ensureVisible should scroll up
            app.sendKey("ArrowDown");
            // selectedIndex = 1, which is still < scrollTop=10
            expect(tree.scrollTop).toBeLessThanOrEqual(1);
        });
    });

    describe("refresh with element", () => {
        it("invalidates subtree cache on targeted refresh", async () => {
            const getChildrenSpy = vi.fn((element?: TestNode) => {
                if (!element) return NESTED_TREE;
                return element.children ?? [];
            });
            const provider: ITreeDataProvider<TestNode> = {
                getTreeItem: (e) => ({ label: e.label, collapsible: (e.children?.length ?? 0) > 0 }),
                getChildren: getChildrenSpy,
                getKey: (e) => e.id,
            };
            const tree = new TreeViewElement(provider);
            TestApp.createWithContent(tree, new Size(40, 10));
            await tree.refresh();
            await tree.toggleExpand(NESTED_TREE[0]);

            getChildrenSpy.mockClear();
            await tree.refresh(NESTED_TREE[0]);

            // Should re-query children of src since it's expanded
            expect(getChildrenSpy).toHaveBeenCalled();
        });

        it("preserves selection after targeted refresh", async () => {
            const { tree, app } = createTree(NESTED_TREE);
            await tree.refresh();
            app.render();

            app.sendKey("ArrowDown"); // select README.md

            const selectSpy = vi.fn();
            tree.onSelect = selectSpy;

            await tree.refresh(NESTED_TREE[0]);

            // After refresh, selection should still be on README.md (index 1)
            // The onSelect won't fire from refresh, but we can verify by pressing ArrowDown
            app.sendKey("ArrowDown");
            expect(selectSpy).toHaveBeenCalledWith(NESTED_TREE[1]);
        });
    });

    describe("refresh after deletion", () => {
        // The active-selection background marks the cursor row when the tree is focused.
        const ACTIVE_BG = packRgb(4, 57, 94);

        it("keeps the cursor near the deleted node instead of jumping to the top", async () => {
            const roots: TestNode[] = [
                { id: "a", label: "Alpha" },
                { id: "b", label: "Beta" },
                { id: "c", label: "Gamma" },
                { id: "d", label: "Delta" },
            ];
            const { tree, app } = createTree(roots);
            await tree.refresh();

            // Move the cursor onto "Beta" (row 1).
            app.sendKey("ArrowDown");
            app.render();
            expect(app.backend.getBgAt(new Point(0, 1))).toBe(ACTIVE_BG);

            // Delete "Beta" and refresh — "Gamma" now shifts into row 1.
            roots.splice(1, 1);
            await tree.refresh();
            app.render();

            expect(app.backend.getBgAt(new Point(0, 1))).toBe(ACTIVE_BG);
            expect(app.backend.getBgAt(new Point(0, 0))).not.toBe(ACTIVE_BG);
        });

        it("keeps the cursor at the top when the selected first node is deleted", async () => {
            const roots: TestNode[] = [
                { id: "a", label: "Alpha" },
                { id: "b", label: "Beta" },
                { id: "c", label: "Gamma" },
            ];
            const { tree, app } = createTree(roots);
            await tree.refresh();
            app.render();

            // Cursor starts on the first row, "Alpha" (row 0).
            expect(app.backend.getBgAt(new Point(0, 0))).toBe(ACTIVE_BG);

            // Delete the first node — "Beta" shifts into row 0 and stays selected.
            roots.splice(0, 1);
            await tree.refresh();
            app.render();

            expect(app.backend.getBgAt(new Point(0, 0))).toBe(ACTIVE_BG);
            expect(app.backend.getBgAt(new Point(0, 1))).not.toBe(ACTIVE_BG);
        });

        it("clamps the cursor to the last row when the deleted node was last", async () => {
            const roots: TestNode[] = [
                { id: "a", label: "Alpha" },
                { id: "b", label: "Beta" },
                { id: "c", label: "Gamma" },
            ];
            const { tree, app } = createTree(roots);
            await tree.refresh();

            // Move the cursor onto the last row, "Gamma" (row 2).
            app.sendKey("ArrowDown");
            app.sendKey("ArrowDown");
            app.render();
            expect(app.backend.getBgAt(new Point(0, 2))).toBe(ACTIVE_BG);

            // Delete the last node — cursor clamps to the new last row, "Beta" (row 1).
            roots.splice(2, 1);
            await tree.refresh();
            app.render();

            expect(app.backend.getBgAt(new Point(0, 1))).toBe(ACTIVE_BG);
            expect(app.backend.getBgAt(new Point(0, 0))).not.toBe(ACTIVE_BG);
        });

        it("does not crash when the only node is deleted", async () => {
            const roots: TestNode[] = [{ id: "a", label: "Alpha" }];
            const { tree, app } = createTree(roots);
            await tree.refresh();
            app.render();

            roots.splice(0, 1);
            await tree.refresh();
            app.render();

            expect(tree.contentHeight).toBe(0);
        });
    });

    describe("onChange callback", () => {
        it("triggers refresh when provider calls onChange", async () => {
            const { tree, provider } = createTree(FLAT_TREE);
            await tree.refresh();
            expect(tree.contentHeight).toBe(3);

            // Mutate the source data - provider will return new data
            FLAT_TREE.push({ id: "d", label: "Delta" });

            // Trigger onChange
            provider.onChange?.();

            // Wait for async refresh
            await new Promise((r) => setTimeout(r, 10));

            expect(tree.contentHeight).toBe(4);

            // Cleanup
            FLAT_TREE.pop();
        });
    });

    describe("page navigation", () => {
        function makeLargeTree(count: number): TestNode[] {
            return Array.from({ length: count }, (_, i) => ({
                id: `item-${String(i)}`,
                label: `Item ${String(i)}`,
            }));
        }

        it("focusPageDown moves selection by viewportHeight - 1", async () => {
            const items = makeLargeTree(30);
            const { tree, app } = createTree(items, new Size(40, 10));
            await tree.refresh();
            app.render();

            tree.focusPageDown();
            const selectSpy = vi.fn();
            tree.onSelect = selectSpy;

            // Verify position by pressing ArrowDown from current position
            app.sendKey("ArrowDown");
            // focusPageDown moves from 0 to 9 (viewport=10, page=9), then ArrowDown goes to 10
            expect(selectSpy).toHaveBeenCalledWith(items[10]);
        });

        it("focusPageDown clamps at the end of the list", async () => {
            const items = makeLargeTree(15);
            const { tree, app } = createTree(items, new Size(40, 10));
            await tree.refresh();
            app.render();

            // Move to item 10
            for (let i = 0; i < 10; i++) app.sendKey("ArrowDown");

            const selectSpy = vi.fn();
            tree.onSelect = selectSpy;

            tree.focusPageDown();
            // From index 10, pageSize=9, would be 19 but clamped to 14
            expect(selectSpy).toHaveBeenCalledWith(items[14]);
        });

        it("focusPageUp moves selection up by viewportHeight - 1", async () => {
            const items = makeLargeTree(30);
            const { tree, app } = createTree(items, new Size(40, 10));
            await tree.refresh();
            app.render();

            // Move to index 20
            for (let i = 0; i < 20; i++) app.sendKey("ArrowDown");

            const selectSpy = vi.fn();
            tree.onSelect = selectSpy;

            tree.focusPageUp();
            // From index 20, pageSize=9, target = 11
            expect(selectSpy).toHaveBeenCalledWith(items[11]);
        });

        it("focusPageUp clamps at the beginning of the list", async () => {
            const items = makeLargeTree(30);
            const { tree, app } = createTree(items, new Size(40, 10));
            await tree.refresh();
            app.render();

            // Move to index 3
            for (let i = 0; i < 3; i++) app.sendKey("ArrowDown");

            const selectSpy = vi.fn();
            tree.onSelect = selectSpy;

            tree.focusPageUp();
            // From index 3, pageSize=9, would be -6 but clamped to 0
            expect(selectSpy).toHaveBeenCalledWith(items[0]);
        });
    });
});
