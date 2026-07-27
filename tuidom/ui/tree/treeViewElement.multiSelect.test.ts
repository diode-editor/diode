import { describe, expect, it } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { TUIContextMenuEvent, TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";

import type { ITreeDataProvider, ITreeItem } from "./iTreeDataProvider.ts";
import { TreeViewElement } from "./treeViewElement.ts";

interface TestNode {
    id: string;
    label: string;
}

const FLAT_TREE: TestNode[] = [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
    { id: "c", label: "Gamma" },
    { id: "d", label: "Delta" },
];

function createProvider(roots: TestNode[]): ITreeDataProvider<TestNode> {
    return {
        getTreeItem(element: TestNode): ITreeItem {
            return { label: element.label, collapsible: false };
        },
        getChildren(): TestNode[] {
            return roots;
        },
        getKey(element: TestNode): string {
            return element.id;
        },
    };
}

async function createTree(roots: TestNode[], viewportSize: Size = new Size(40, 10)) {
    const provider = createProvider(roots);
    const tree = new TreeViewElement(provider);
    const app = TestApp.createWithContent(tree, viewportSize);
    tree.localPosition = new Offset(0, 0);
    tree.performLayout(BoxConstraints.tight(viewportSize));
    tree.focus();
    await tree.refresh();
    return { tree, app };
}

function click(
    tree: TreeViewElement<TestNode>,
    row: number,
    mods: { ctrlKey?: boolean; shiftKey?: boolean } = {},
): void {
    tree.dispatchEvent(
        new TUIMouseEvent("click", {
            button: "left",
            screenX: 5,
            screenY: row,
            localX: 5,
            localY: row,
            ctrlKey: mods.ctrlKey,
            shiftKey: mods.shiftKey,
        }),
    );
}

function key(tree: TreeViewElement<TestNode>, name: string, shiftKey = false): void {
    tree.dispatchEvent(new TUIKeyboardEvent("keypress", { key: name, shiftKey }));
}

function selectedIds(tree: TreeViewElement<TestNode>): string[] {
    return tree.getSelectedNodes().map((n) => n.id);
}

describe("TreeViewElement - multi-selection", () => {
    it("getSelectedNode returns the cursor node", async () => {
        const { tree } = await createTree(FLAT_TREE);
        key(tree, "ArrowDown");
        expect(tree.getSelectedNode()?.id).toBe("b");
    });

    it("returns the cursor node as a single-element selection by default", async () => {
        const { tree } = await createTree(FLAT_TREE);
        click(tree, 2);
        expect(selectedIds(tree)).toEqual(["c"]);
    });

    it("Ctrl+click adds individual rows to the selection", async () => {
        const { tree } = await createTree(FLAT_TREE);
        click(tree, 0);
        click(tree, 2, { ctrlKey: true });
        expect(selectedIds(tree)).toEqual(["a", "c"]);
    });

    it("Ctrl+click toggles an already-selected row off", async () => {
        const { tree } = await createTree(FLAT_TREE);
        click(tree, 0);
        click(tree, 2, { ctrlKey: true });
        click(tree, 2, { ctrlKey: true });
        expect(selectedIds(tree)).toEqual(["a"]);
    });

    it("Shift+click selects a contiguous range from the anchor", async () => {
        const { tree } = await createTree(FLAT_TREE);
        click(tree, 1);
        click(tree, 3, { shiftKey: true });
        expect(selectedIds(tree)).toEqual(["b", "c", "d"]);
    });

    it("Shift+ArrowDown extends the selection", async () => {
        const { tree } = await createTree(FLAT_TREE);
        // cursor starts at index 0
        key(tree, "ArrowDown", true);
        key(tree, "ArrowDown", true);
        expect(selectedIds(tree)).toEqual(["a", "b", "c"]);
        expect(tree.getSelectedNode()?.id).toBe("c");
    });

    it("a plain arrow after a multi-selection collapses back to a single node", async () => {
        const { tree } = await createTree(FLAT_TREE);
        click(tree, 0);
        click(tree, 2, { ctrlKey: true });
        expect(selectedIds(tree)).toEqual(["a", "c"]);

        key(tree, "ArrowDown");
        expect(selectedIds(tree)).toEqual(["d"]);
    });

    it("Shift+ArrowUp extends the selection upwards", async () => {
        const { tree } = await createTree(FLAT_TREE);
        click(tree, 2); // курсор и якорь на Gamma
        key(tree, "ArrowUp", true);
        expect(selectedIds(tree)).toEqual(["b", "c"]);
        expect(tree.getSelectedNode()?.id).toBe("b");
    });

    it("Shift+ArrowUp on the first row clamps to the top", async () => {
        const { tree } = await createTree(FLAT_TREE);
        // курсор на первой строке — расширять некуда, выбор остаётся из одной строки
        key(tree, "ArrowUp", true);
        expect(selectedIds(tree)).toEqual(["a"]);
        expect(tree.getSelectedNode()?.id).toBe("a");
    });

    it("Shift+ArrowDown on the last row clamps to the bottom", async () => {
        const { tree } = await createTree(FLAT_TREE);
        click(tree, 3);
        key(tree, "ArrowDown", true);
        expect(selectedIds(tree)).toEqual(["d"]);
        expect(tree.getSelectedNode()?.id).toBe("d");
    });

    it("right-click on an already-selected row keeps the multi-selection", async () => {
        const { tree } = await createTree(FLAT_TREE);
        const contextNodes: string[] = [];
        tree.onContextMenu = (node) => {
            contextNodes.push(node.id);
        };
        click(tree, 1);
        click(tree, 3, { shiftKey: true }); // выбраны b, c, d

        tree.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "mouse",
                button: "right",
                screenX: 5,
                screenY: 2,
                localX: 5,
                localY: 2,
            }),
        );

        expect(selectedIds(tree)).toEqual(["b", "c", "d"]); // выбор не сброшен
        expect(tree.getSelectedNode()?.id).toBe("c"); // но курсор перескочил на кликнутую строку
        expect(contextNodes).toEqual(["c"]);
    });
});

describe("TreeViewElement - empty tree", () => {
    it("reports no selection", async () => {
        const { tree } = await createTree([]);
        expect(tree.getSelectedNode()).toBeNull();
        expect(tree.getSelectedNodes()).toEqual([]);
    });

    it("ignores selection-extending keys without crashing", async () => {
        const { tree } = await createTree([]);
        key(tree, "ArrowUp", true);
        key(tree, "ArrowDown", true);
        expect(tree.getSelectedNodes()).toEqual([]);
    });
});
