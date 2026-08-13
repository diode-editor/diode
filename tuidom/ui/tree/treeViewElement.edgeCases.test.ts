import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { TUIMouseEvent, type TUIMouseEventType, type WheelDirection } from "../../dom/events/tuiMouseEvent.ts";

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
    options?: { leftPadding?: number },
): { tree: TreeViewElement<TestNode>; app: TestApp; provider: ITreeDataProvider<TestNode> } {
    const provider = createProvider(roots);
    const tree = new TreeViewElement(provider, options);
    const app = TestApp.createWithContent(tree, viewportSize);
    tree.localPosition = new Offset(0, 0);
    tree.layout(BoxConstraints.tight(viewportSize));
    tree.focus();
    return { tree, app, provider };
}

function mouseEvent(
    type: TUIMouseEventType,
    opts: {
        button?: "left" | "right";
        localX?: number;
        localY?: number;
        screenX?: number;
        screenY?: number;
        wheelDirection?: WheelDirection;
    },
): TUIMouseEvent {
    const localX = opts.localX ?? 0;
    const localY = opts.localY ?? 0;
    return new TUIMouseEvent(type, {
        button: opts.button ?? "left",
        screenX: opts.screenX ?? localX,
        screenY: opts.screenY ?? localY,
        localX,
        localY,
        wheelDirection: opts.wheelDirection,
    });
}

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

function cloneNested(): TestNode[] {
    return JSON.parse(JSON.stringify(NESTED_TREE)) as TestNode[];
}

// ─── Tests ───

describe("TreeViewElement edge cases", () => {
    describe("double-click (dblclick)", () => {
        it("toggles expand on dbl-click of a collapsible row", async () => {
            const { tree } = createTree(cloneNested());
            await tree.refresh();
            expect(tree.contentHeight).toBe(2);

            // Row 0 = src (collapsible)
            tree.dispatchEvent(mouseEvent("dblclick", { localX: 5, localY: 0 }));
            await Promise.resolve();

            expect(tree.contentHeight).toBe(4); // expanded
        });

        it("fires onActivate on dbl-click of a leaf row", async () => {
            const roots = cloneNested();
            const { tree } = createTree(roots);
            await tree.refresh();

            const onActivate = vi.fn();
            tree.onActivate = onActivate;

            // Row 1 = README.md (leaf)
            tree.dispatchEvent(mouseEvent("dblclick", { localX: 5, localY: 1 }));

            expect(onActivate).toHaveBeenCalledOnce();
            const [el] = onActivate.mock.calls[0] as [TestNode];
            expect(el.id).toBe("README.md");
        });

        it("ignores dbl-click outside the content bounds", async () => {
            const { tree } = createTree(cloneNested());
            await tree.refresh();
            const onActivate = vi.fn();
            tree.onActivate = onActivate;

            tree.dispatchEvent(mouseEvent("dblclick", { localX: 5, localY: 50 }));

            expect(onActivate).not.toHaveBeenCalled();
            expect(tree.contentHeight).toBe(2);
        });
    });

    describe("click on expand icon", () => {
        it("toggles expand when clicking the expand-icon column", async () => {
            const { tree } = createTree(cloneNested());
            await tree.refresh();
            expect(tree.contentHeight).toBe(2);

            // expand icon for a depth-0 row is at column 0
            tree.dispatchEvent(mouseEvent("click", { localX: 0, localY: 0 }));
            await Promise.resolve();

            expect(tree.contentHeight).toBe(4);
        });

        it("does NOT toggle expand when clicking past the expand-icon column", async () => {
            const { tree } = createTree(cloneNested());
            await tree.refresh();

            // Click on the label area (well past the expand icon)
            tree.dispatchEvent(mouseEvent("click", { localX: 6, localY: 0 }));
            await Promise.resolve();

            expect(tree.contentHeight).toBe(2); // unchanged
        });

        it("selects the clicked row even when not toggling", async () => {
            const { tree } = createTree(cloneNested());
            await tree.refresh();
            const onSelect = vi.fn();
            tree.onSelect = onSelect;

            tree.dispatchEvent(mouseEvent("click", { localX: 6, localY: 1 }));

            const [el] = onSelect.mock.calls[0] as [TestNode];
            expect(el.id).toBe("README.md");
        });

        it("hits the arrow at its column shifted by leftPadding", async () => {
            const { tree } = createTree(cloneNested(), new Size(40, 10), { leftPadding: 1 });
            await tree.refresh();
            expect(tree.contentHeight).toBe(2);

            // The depth-0 expand icon moves from column 0 to column 1.
            tree.dispatchEvent(mouseEvent("click", { localX: 1, localY: 0 }));
            await Promise.resolve();

            expect(tree.contentHeight).toBe(4);
        });

        it("does not treat the padding gutter as the arrow", async () => {
            const { tree } = createTree(cloneNested(), new Size(40, 10), { leftPadding: 1 });
            await tree.refresh();

            tree.dispatchEvent(mouseEvent("click", { localX: 0, localY: 0 }));
            await Promise.resolve();

            expect(tree.contentHeight).toBe(2); // unchanged
        });
    });

    describe("mouse wheel scrolling", () => {
        function makeLong(count: number): TestNode[] {
            return Array.from({ length: count }, (_, i) => ({
                id: `n-${String(i)}`,
                label: `Item ${String(i)}`,
            }));
        }

        it("scrolls down on wheel-down", async () => {
            const { tree } = createTree(makeLong(40), new Size(20, 5));
            await tree.refresh();
            expect(tree.scrollTop).toBe(0);

            tree.dispatchEvent(mouseEvent("wheel", { localX: 1, localY: 1, wheelDirection: "down" }));

            expect(tree.scrollTop).toBe(3);
        });

        it("scrolls back up on wheel-up", async () => {
            const { tree } = createTree(makeLong(40), new Size(20, 5));
            await tree.refresh();
            tree.scrollTo(0, 10);

            tree.dispatchEvent(mouseEvent("wheel", { localX: 1, localY: 1, wheelDirection: "up" }));

            expect(tree.scrollTop).toBe(7);
        });

        it("clamps scroll at the top when wheel-up at top", async () => {
            const { tree } = createTree(makeLong(40), new Size(20, 5));
            await tree.refresh();

            tree.dispatchEvent(mouseEvent("wheel", { localX: 1, localY: 1, wheelDirection: "up" }));

            expect(tree.scrollTop).toBe(0);
        });
    });

    describe("mouse hover and leave", () => {
        it("clears hover highlight on mouseleave", async () => {
            const HOVER_BG = 0x123456;
            const roots: TestNode[] = [
                { id: "a", label: "Alpha" },
                { id: "b", label: "Beta" },
                { id: "c", label: "Gamma" },
            ];
            const { tree, app } = createTree(roots, new Size(20, 5));
            tree.setStyleVars({ "list.hoverBackground": HOVER_BG });
            await tree.refresh();
            app.render();

            // Hover row 1 (Beta)
            tree.dispatchEvent(mouseEvent("mousemove", { localX: 4, localY: 1 }));
            app.render();
            expect(app.backend.getBgAt(new Point(0, 1))).toBe(HOVER_BG);

            // Leave clears the hover
            tree.dispatchEvent(mouseEvent("mouseleave", { localX: 4, localY: 1 }));
            app.render();
            expect(app.backend.getBgAt(new Point(0, 1))).not.toBe(HOVER_BG);
        });

        it("mouseleave with no active hover is a no-op (no highlight appears)", async () => {
            const HOVER_BG = 0x654321;
            const roots: TestNode[] = [{ id: "a", label: "Alpha" }];
            const { tree, app } = createTree(roots, new Size(20, 3));
            tree.setStyleVars({ "list.hoverBackground": HOVER_BG });
            await tree.refresh();
            app.render();

            tree.dispatchEvent(mouseEvent("mouseleave", { localX: 0, localY: 0 }));
            app.render();

            expect(app.backend.getBgAt(new Point(0, 0))).not.toBe(HOVER_BG);
        });
    });

    describe("refresh with pre-existing expanded subtrees", () => {
        it("reloads root and re-expands already-expanded nodes (refresh without element)", async () => {
            const roots = cloneNested();
            const getChildren = vi.fn((element?: TestNode) => {
                if (!element) return roots;
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
            void app;

            await tree.refresh();
            await tree.toggleExpand(roots[0]); // expand src
            const utils = roots[0].children![0];
            await tree.toggleExpand(utils); // expand src/utils (nested expand)

            // src, utils, helper.ts, main.ts, README.md = 5
            expect(tree.contentHeight).toBe(5);

            getChildren.mockClear();
            // Full refresh: clears cache and must reload root + recurse into expanded keys
            await tree.refresh();

            // Root reload + src + utils were all re-queried
            expect(getChildren).toHaveBeenCalled();
            // The whole expanded structure is restored
            expect(tree.contentHeight).toBe(5);
        });

        it("targeted refresh recurses into an expanded child subtree", async () => {
            const roots = cloneNested();
            const getChildren = vi.fn((element?: TestNode) => {
                if (!element) return roots;
                return element.children ?? [];
            });
            const provider: ITreeDataProvider<TestNode> = {
                getTreeItem: (e) => ({ label: e.label, collapsible: (e.children?.length ?? 0) > 0 }),
                getChildren,
                getKey: (e) => e.id,
            };
            const tree = new TreeViewElement(provider);
            TestApp.createWithContent(tree, new Size(40, 10));
            tree.layout(BoxConstraints.tight(new Size(40, 10)));

            await tree.refresh();
            await tree.toggleExpand(roots[0]); // expand src
            const utils = roots[0].children![0];
            await tree.toggleExpand(utils); // expand utils — now src has an expanded child

            getChildren.mockClear();
            // Targeted refresh of src must recurse into its expanded child (utils)
            await tree.refresh(roots[0]);

            const queried = getChildren.mock.calls.map((c) => c[0]?.id);
            expect(queried).toContain("src");
            expect(queried).toContain("src/utils");
            expect(tree.contentHeight).toBe(5);
        });

        it("keeps a descendant expanded after collapsing and re-expanding its parent", async () => {
            const roots = cloneNested();
            const { tree } = createTree(roots);
            await tree.refresh();

            await tree.toggleExpand(roots[0]); // expand src
            const utils = roots[0].children![0];
            await tree.toggleExpand(utils); // expand utils
            expect(tree.contentHeight).toBe(5);

            await tree.toggleExpand(roots[0]); // collapse src — utils hidden but still "expanded"
            expect(tree.contentHeight).toBe(2);

            // Re-expanding src restores the previously-expanded utils + helper.ts.
            await tree.toggleExpand(roots[0]);
            expect(tree.contentHeight).toBe(5);
        });
    });

    describe("rendering wide characters", () => {
        it("renders a wide (CJK) label and truncates a wide char at the right viewport edge", async () => {
            // Label of CJK chars, each 2 cells wide.
            const roots: TestNode[] = [{ id: "x", label: "字字字字" }];
            const { tree, app } = createTree(roots, new Size(7, 1));
            await tree.refresh();
            app.render();

            // Row text = " " (expand) + " " + label  => 2 spaces then CJK glyphs.
            // Viewport width 7: cols 0,1 are spaces; col 2-3 字, col4-5 字, col6 would
            // start a wide char with no room → rendered as a single blank cell.
            expect(app.backend.getTextAt(new Point(0, 0), 2)).toBe("  ");
            // A wide glyph is placed at col 2.
            expect(app.backend.getTextAt(new Point(2, 0), 1)).toBe("字");
            // Last column can't fit a wide glyph → blank placeholder, not half a glyph.
            expect(app.backend.getTextAt(new Point(6, 0), 1)).toBe(" ");
        });

        it("handles a horizontal scroll that lands inside a wide grapheme", async () => {
            const roots: TestNode[] = [{ id: "x", label: "字字字字" }];
            const { tree, app } = createTree(roots, new Size(6, 1));
            await tree.refresh();

            // scrollLeft = 3 lands on the trailing column of the first CJK glyph
            // (cols: 0,1 spaces; 2-3 first 字). Column 3 is the wide char's tail → "".
            tree.scrollTo(3, 0);
            app.render();

            // First visible column is a continuation of a clipped wide glyph → blank,
            // remaining glyphs still render somewhere in the row.
            expect(app.backend.getTextAt(new Point(0, 0), 6)).toContain("字");
            expect(tree.scrollLeft).toBe(3);
        });
    });
});
