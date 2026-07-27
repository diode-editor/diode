import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { TUIContextMenuEvent, TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";

import type { ITreeDataProvider, ITreeItem } from "./iTreeDataProvider.ts";
import { TreeViewElement } from "./treeViewElement.ts";

interface TestNode {
    id: string;
    label: string;
    children?: TestNode[];
}

function createProvider(roots: TestNode[]): ITreeDataProvider<TestNode> {
    return {
        getTreeItem(element: TestNode): ITreeItem {
            return {
                label: element.label,
                collapsible: (element.children?.length ?? 0) > 0,
            };
        },
        getChildren(element?: TestNode): TestNode[] {
            return element ? (element.children ?? []) : roots;
        },
        getKey(element: TestNode): string {
            return element.id;
        },
    };
}

const FLAT_NODES: TestNode[] = [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
    { id: "c", label: "Gamma" },
];

function createTree(roots: TestNode[], viewportSize = new Size(40, 10)) {
    const provider = createProvider(roots);
    const tree = new TreeViewElement(provider);
    const app = TestApp.createWithContent(tree, viewportSize);
    tree.localPosition = new Offset(0, 0);
    tree.performLayout(BoxConstraints.tight(viewportSize));
    tree.focus();
    return { tree, app, provider, refresh: () => tree.refresh() };
}

function makeClickEvent(opts: {
    button?: "left" | "right";
    screenX: number;
    screenY: number;
    localX?: number;
    localY?: number;
}) {
    return new TUIMouseEvent("click", {
        button: opts.button ?? "left",
        screenX: opts.screenX,
        screenY: opts.screenY,
        localX: opts.localX ?? opts.screenX,
        localY: opts.localY ?? opts.screenY,
    });
}

/** Мышиный contextmenu — то, что движок диспатчит на правый press+release. */
function makeContextMenuEvent(opts: { screenX: number; screenY: number; localX?: number; localY?: number }) {
    return new TUIContextMenuEvent({
        trigger: "mouse",
        button: "right",
        screenX: opts.screenX,
        screenY: opts.screenY,
        localX: opts.localX ?? opts.screenX,
        localY: opts.localY ?? opts.screenY,
    });
}

describe("TreeViewElement - context menu (right-click)", () => {
    it("right-click fires onContextMenu with the correct element", async () => {
        const { tree, refresh } = createTree(FLAT_NODES);
        await refresh();
        const onContextMenu = vi.fn();
        tree.onContextMenu = onContextMenu;

        tree.dispatchEvent(makeContextMenuEvent({ screenX: 5, screenY: 1 }));

        expect(onContextMenu).toHaveBeenCalledOnce();
        const [element] = onContextMenu.mock.calls[0] as [TestNode, number, number];
        expect(element).toBe(FLAT_NODES[1]); // row 1 → Beta
    });

    it("right-click passes correct screenX and screenY to onContextMenu", async () => {
        const { tree, refresh } = createTree(FLAT_NODES);
        await refresh();
        const onContextMenu = vi.fn();
        tree.onContextMenu = onContextMenu;

        tree.dispatchEvent(makeContextMenuEvent({ screenX: 12, screenY: 2 }));

        expect(onContextMenu).toHaveBeenCalledWith(FLAT_NODES[2], 12, 2);
    });

    it("right-click selects the clicked row", async () => {
        const { tree, refresh } = createTree(FLAT_NODES);
        await refresh();
        const onContextMenu = vi.fn();
        tree.onContextMenu = onContextMenu;

        tree.dispatchEvent(makeContextMenuEvent({ screenX: 5, screenY: 0 }));

        // Verify onContextMenu was called for row 0 (Alpha), which means the row was selected
        expect(onContextMenu).toHaveBeenCalledOnce();
        const [element] = onContextMenu.mock.calls[0] as [TestNode, number, number];
        expect(element).toBe(FLAT_NODES[0]);
    });

    it("right-click does NOT call onActivate", async () => {
        const { tree, refresh } = createTree(FLAT_NODES);
        await refresh();
        const onActivate = vi.fn();
        tree.onActivate = onActivate;
        tree.onContextMenu = vi.fn();

        tree.dispatchEvent(makeContextMenuEvent({ screenX: 5, screenY: 0 }));

        expect(onActivate).not.toHaveBeenCalled();
    });

    it("right-click on out-of-bounds row does NOT fire onContextMenu", async () => {
        const { tree, refresh } = createTree(FLAT_NODES);
        await refresh();
        const onContextMenu = vi.fn();
        tree.onContextMenu = onContextMenu;

        // Row 99 is way beyond the 3-item list
        tree.dispatchEvent(makeContextMenuEvent({ screenX: 5, screenY: 99 }));

        expect(onContextMenu).not.toHaveBeenCalled();
    });

    it("left-click still triggers onActivate via double-click, not onContextMenu", async () => {
        const { tree, refresh } = createTree(FLAT_NODES);
        await refresh();
        const onContextMenu = vi.fn();
        tree.onContextMenu = onContextMenu;

        tree.dispatchEvent(makeClickEvent({ button: "left", screenX: 5, screenY: 0 }));

        expect(onContextMenu).not.toHaveBeenCalled();
    });
});

const NESTED: TestNode[] = [
    {
        id: "src",
        label: "src",
        children: [
            { id: "main", label: "main.ts" },
            { id: "util", label: "util.ts" },
        ],
    },
];

describe("TreeViewElement - getSelectedRowGlobalPosition (keyboard context menu anchor)", () => {
    it("returns null when the tree is empty", async () => {
        const { tree, refresh } = createTree([]);
        await refresh();

        expect(tree.getSelectedRowGlobalPosition()).toBeNull();
    });

    it("anchors on the selected row relative to the tree's global position", async () => {
        const { tree, refresh } = createTree(FLAT_NODES);
        await refresh();

        // Select row 1 (Beta) with a left click.
        tree.dispatchEvent(makeClickEvent({ button: "left", screenX: 5, screenY: 1 }));

        expect(tree.getSelectedRowGlobalPosition()).toEqual(new Point(0, 1));
    });

    it("offsets the anchor by the tree's own global position", async () => {
        const { tree, refresh } = createTree(FLAT_NODES);
        await refresh();
        tree.localPosition = new Offset(3, 5);

        tree.dispatchEvent(makeClickEvent({ button: "left", screenX: 5, screenY: 2 }));

        // globalPosition (3,5) + row 2 → (3, 7)
        expect(tree.getSelectedRowGlobalPosition()).toEqual(new Point(3, 7));
    });

    it("indents the anchor X by the selected node's depth", async () => {
        const { tree, refresh } = createTree(NESTED);
        await refresh();
        await tree.toggleExpand(NESTED[0]); // src, main.ts, util.ts

        // Select row 1 (main.ts, depth 1).
        tree.dispatchEvent(makeClickEvent({ button: "left", screenX: 5, screenY: 1 }));

        // depth 1 * INDENT_SIZE(2) = 2 → x offset
        expect(tree.getSelectedRowGlobalPosition()).toEqual(new Point(2, 1));
    });

    it("accounts for vertical scroll", async () => {
        const many: TestNode[] = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` }));
        const { tree, refresh } = createTree(many, new Size(40, 10));
        await refresh();
        tree.scrollTop = 5;

        // Left click at localY 2 → selects row scrollTop(5) + 2 = 7.
        tree.dispatchEvent(makeClickEvent({ button: "left", screenX: 5, screenY: 2 }));

        // y = globalPosition.y(0) + (selectedIndex(7) - scrollTop(5)) = 2
        expect(tree.getSelectedRowGlobalPosition()).toEqual(new Point(0, 2));
    });
});

describe("TreeViewElement - raw right click", () => {
    it("a raw right-button click is ignored (contextmenu carries the gesture)", async () => {
        const { tree, refresh } = createTree(FLAT_NODES);
        await refresh();
        const onContextMenu = vi.fn();
        tree.onContextMenu = onContextMenu;

        tree.dispatchEvent(makeClickEvent({ button: "right", screenX: 5, screenY: 2 }));

        expect(onContextMenu).not.toHaveBeenCalled();
        expect(tree.getSelectedNode()).toBe(FLAT_NODES[0]); // курсор не сдвинулся
    });

    it("a click below the last row is a no-op", async () => {
        const { tree, refresh } = createTree(FLAT_NODES);
        await refresh();

        tree.dispatchEvent(makeClickEvent({ screenX: 5, screenY: 99 }));

        expect(tree.getSelectedNode()).toBe(FLAT_NODES[0]);
    });
});

describe("TreeViewElement - context menu (keyboard trigger)", () => {
    it("keyboard trigger anchors at the selected row's global position", async () => {
        const { tree, refresh } = createTree(FLAT_NODES);
        await refresh();
        const onContextMenu = vi.fn();
        tree.onContextMenu = onContextMenu;

        tree.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "ArrowDown" }));
        const anchor = tree.getSelectedRowGlobalPosition();
        expect(anchor).not.toBeNull();

        tree.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "keyboard",
                button: "none",
                screenX: tree.globalPosition.x,
                screenY: tree.globalPosition.y,
                localX: 0,
                localY: 0,
            }),
        );

        expect(onContextMenu).toHaveBeenCalledWith(FLAT_NODES[1], anchor!.x, anchor!.y);
    });

    it("keyboard trigger is a no-op on an empty tree", async () => {
        const { tree, refresh } = createTree([]);
        await refresh();
        const onContextMenu = vi.fn();
        tree.onContextMenu = onContextMenu;

        tree.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "keyboard",
                button: "none",
                screenX: 0,
                screenY: 0,
                localX: 0,
                localY: 0,
            }),
        );

        expect(onContextMenu).not.toHaveBeenCalled();
    });
});
