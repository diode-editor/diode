import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";

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

function createTree(
    roots: TestNode[],
    viewportSize: Size = new Size(40, 10),
): { tree: TreeViewElement<TestNode>; app: TestApp; provider: ITreeDataProvider<TestNode> } {
    const provider = createProvider(roots);
    const tree = new TreeViewElement(provider);
    const app = TestApp.createWithContent(tree, viewportSize);
    tree.localPosition = new Offset(0, 0);
    tree.layout(BoxConstraints.tight(viewportSize));
    tree.focus();
    return { tree, app, provider };
}

function makeList(count: number): TestNode[] {
    return Array.from({ length: count }, (_, i) => ({
        id: `item-${String(i)}`,
        label: `Item${String(i)}`,
    }));
}

function rowLabels(app: TestApp, width: number, height: number): string[] {
    return Array.from({ length: height }, (_, y) => app.backend.getTextAt(new Point(0, y), width).trimEnd());
}

describe("TreeViewElement scroll + render behavior", () => {
    describe("auto-scroll on navigation (rendered viewport)", () => {
        it("scrolls the top item off-screen when the cursor moves past the last visible row", async () => {
            const { tree, app } = createTree(makeList(20), new Size(20, 5));
            await tree.refresh();
            app.render();

            // Before scrolling: Item0 is the first visible row.
            expect(rowLabels(app, 20, 5)[0]).toBe("  Item0");

            // Move the cursor down 6 times: index 0 → 6. Viewport height 5,
            // so once the cursor passes index 4 the viewport must scroll.
            for (let i = 0; i < 6; i++) app.sendKey("ArrowDown");
            app.render();

            expect(tree.scrollTop).toBe(2); // index 6 - 5 + 1
            const labels = rowLabels(app, 20, 5);
            // Item0 / Item1 are scrolled out; Item2 is now the top row.
            expect(labels[0]).toBe("  Item2");
            expect(labels).not.toContain("  Item0");
            // The selected (Item6) is the last visible row.
            expect(labels[4]).toBe("  Item6");
        });

        it("scrolls back up so the cursor stays visible when moving up above the viewport", async () => {
            const { tree, app } = createTree(makeList(20), new Size(20, 5));
            await tree.refresh();
            // Place cursor at the bottom, scrolled down.
            for (let i = 0; i < 10; i++) app.sendKey("ArrowDown");
            app.render();
            expect(tree.scrollTop).toBeGreaterThan(0);

            // Now move up far enough to push the cursor above the viewport top.
            for (let i = 0; i < 8; i++) app.sendKey("ArrowUp");
            app.render();

            // Cursor is index 2; viewport scrolls up so index 2 becomes the top row.
            expect(tree.scrollTop).toBe(2);
            expect(rowLabels(app, 20, 5)[0]).toBe("  Item2");
        });

        it("does not scroll while the cursor stays within the visible window", async () => {
            const { tree, app } = createTree(makeList(20), new Size(20, 5));
            await tree.refresh();
            app.render();

            // Move down 3 (index 3) — still inside rows 0..4.
            for (let i = 0; i < 3; i++) app.sendKey("ArrowDown");
            app.render();

            expect(tree.scrollTop).toBe(0);
            expect(rowLabels(app, 20, 5)[0]).toBe("  Item0");
        });
    });

    describe("page navigation scroll", () => {
        it("focusPageDown scrolls the viewport to keep the new cursor visible", async () => {
            const { tree, app } = createTree(makeList(30), new Size(20, 10));
            await tree.refresh();
            app.render();
            expect(tree.scrollTop).toBe(0);

            tree.focusPageDown(); // 0 → 9 (pageSize = 9)
            app.render();

            // Index 9 was at the very bottom; it stays visible (no scroll needed yet),
            // a second page down must force a scroll.
            tree.focusPageDown(); // 9 → 18
            app.render();
            expect(tree.scrollTop).toBeGreaterThan(0);
            const labels = rowLabels(app, 20, 10);
            expect(labels[labels.length - 1]).toBe("  Item18");
        });
    });

    describe("findElementByKey cache fallback during full refresh", () => {
        it("resolves a nested expanded descendant from cache when it is absent from the flat list", async () => {
            // Tree: src  utils  helper.ts. We expand both, then expand them
            // in such a way that, on a full refresh, the deep reload of "src/utils"
            // must find its element through the children cache rather than the flat
            // list (the flat list is rebuilt only after loading completes).
            const NESTED: TestNode[] = [
                {
                    id: "src",
                    label: "src",
                    children: [
                        {
                            id: "src/utils",
                            label: "utils",
                            children: [{ id: "src/utils/helper.ts", label: "helper.ts" }],
                        },
                    ],
                },
            ];
            const getChildren = vi.fn((element?: TestNode) => {
                if (!element) return NESTED;
                return element.children ?? [];
            });
            const provider: ITreeDataProvider<TestNode> = {
                getTreeItem: (e) => ({ label: e.label, collapsible: (e.children?.length ?? 0) > 0 }),
                getChildren,
                getKey: (e) => e.id,
            };
            const tree = new TreeViewElement(provider);
            const app = TestApp.createWithContent(tree, new Size(40, 10));
            tree.layout(BoxConstraints.tight(new Size(40, 10)));

            await tree.refresh();
            await tree.toggleExpand(NESTED[0]); // expand src
            const utils = NESTED[0].children![0];
            await tree.toggleExpand(utils); // expand src/utils
            expect(tree.contentHeight).toBe(3); // src, utils, helper.ts (all in flat list)

            getChildren.mockClear();
            // Full refresh: childrenCache is cleared, root reloaded, then reload
            // recurses into every expanded key. During that recursion "src" is
            // reloaded first (setting cache["src"] = [utils]); then "src/utils" is
            // resolved — exercising findElementByKey's cache-backed lookup.
            await tree.refresh();

            const queried = getChildren.mock.calls.map((c) => c[0]?.id);
            expect(queried).toContain("src"); // root-level expanded reloaded
            expect(queried).toContain("src/utils"); // deep expanded reloaded
            // The whole expanded structure is restored after refresh.
            app.render();
            expect(tree.contentHeight).toBe(3);
        });
    });

    describe("row rendering details", () => {
        it("renders nested expanded rows with correct indentation and expand markers", async () => {
            const NESTED: TestNode[] = [
                {
                    id: "a",
                    label: "root",
                    children: [{ id: "b", label: "mid", children: [{ id: "c", label: "leaf" }] }],
                },
            ];
            const { tree, app } = createTree(NESTED, new Size(20, 3));
            await tree.refresh();
            await tree.toggleExpand(NESTED[0]);
            await tree.toggleExpand(NESTED[0].children![0]);
            app.render();

            const labels = rowLabels(app, 20, 3);
            expect(labels[0]).toBe(" root"); //  root (depth 0)
            expect(labels[1]).toBe("   mid"); // depth 1 indented + 
            expect(labels[2]).toBe("      leaf"); // depth 2 indented, no marker (leaf)
        });

        it("colors the icon glyph with the provided iconColor", async () => {
            const ICON_COLOR = packRgb(220, 120, 30);
            const roots: TestNode[] = [{ id: "a", label: "file", icon: "F", iconColor: ICON_COLOR }];
            const { tree, app } = createTree(roots, new Size(20, 2));
            await tree.refresh();
            app.render();

            // Row text: " " (expand placeholder) + " " + icon "F" + " " + label.
            // iconStart = depth*2 + 2 = 2 → icon "F" sits at column 2.
            expect(app.backend.getTextAt(new Point(2, 0), 1)).toBe("F");
            expect(app.backend.getFgAt(new Point(2, 0))).toBe(ICON_COLOR);
            // The label is not tinted with the icon color.
            expect(app.backend.getFgAt(new Point(4, 0))).not.toBe(ICON_COLOR);
        });

        it("colors the expand marker of a collapsible row distinctly", async () => {
            const EXPAND_MARKER_FG = packRgb(150, 150, 150);
            const roots: TestNode[] = [{ id: "dir", label: "src", children: [{ id: "f", label: "main.ts" }] }];
            const { tree, app } = createTree(roots, new Size(20, 2));
            await tree.refresh();
            app.render();

            // Expand icon is at column 0 (depth 0).
            expect(app.backend.getTextAt(new Point(0, 0), 1)).toBe("");
            expect(app.backend.getFgAt(new Point(0, 0))).toBe(EXPAND_MARKER_FG);
        });
    });
});
