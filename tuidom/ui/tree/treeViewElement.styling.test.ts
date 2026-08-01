import { describe, expect, it } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import type { MouseToken } from "../../input/rawTerminalToken.ts";

import type { ITreeDataProvider, ITreeItem } from "./iTreeDataProvider.ts";
import { TreeViewElement } from "./treeViewElement.ts";

// ─── Test data ───

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

const ACTIVE_BG = packRgb(4, 57, 94);
const ACTIVE_FG = packRgb(255, 255, 255);
const INACTIVE_BG = packRgb(55, 55, 61);
const INACTIVE_FG = packRgb(204, 204, 204);
const HOVER_BG = packRgb(42, 45, 46);
const CUT_FG = packRgb(128, 128, 128);

function createTree(
    roots: TestNode[],
    viewportSize: Size = new Size(20, 5),
): { tree: TreeViewElement<TestNode>; app: TestApp } {
    const tree = new TreeViewElement(createProvider(roots));
    tree.setStyleVars({
        "list.activeSelectionBackground": ACTIVE_BG,
        "list.activeSelectionForeground": ACTIVE_FG,
        "list.inactiveSelectionBackground": INACTIVE_BG,
        "list.inactiveSelectionForeground": INACTIVE_FG,
        "list.hoverBackground": HOVER_BG,
        "list.deemphasizedForeground": CUT_FG,
    });
    const app = TestApp.createWithContent(tree, viewportSize);
    return { tree, app };
}

function makeMouseToken(overrides: Partial<MouseToken> & { action: MouseToken["action"] }): MouseToken {
    return {
        kind: "mouse",
        button: "left",
        x: 1,
        y: 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
        ...overrides,
    };
}

// ─── Tests ───

describe("TreeViewElement styling", () => {
    describe("active selection (focused)", () => {
        it("uses activeSelectionBg/Fg for cursor row when tree is focused", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            tree.focus();
            app.render();

            // Cursor is on row 0 (Alpha), tree is focused
            const bg = app.backend.getBgAt(new Point(0, 0));
            const fg = app.backend.getFgAt(new Point(3, 0)); // "A" in "Alpha"
            expect(bg).toBe(ACTIVE_BG);
            expect(fg).toBe(ACTIVE_FG);
        });

        it("uses resolved style bg for non-cursor rows when focused", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            tree.focus();
            app.render();

            // Row 1 (Beta) is not selected
            const bg = app.backend.getBgAt(new Point(0, 1));
            expect(bg).not.toBe(ACTIVE_BG);
            expect(bg).not.toBe(INACTIVE_BG);
        });
    });

    describe("inactive selection (unfocused)", () => {
        it("uses inactiveSelectionBg/Fg for cursor row when tree is blurred", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            tree.focus();
            app.render();

            // Blur the tree
            tree.blur();
            app.render();

            const bg = app.backend.getBgAt(new Point(0, 0));
            const fg = app.backend.getFgAt(new Point(3, 0));
            expect(bg).toBe(INACTIVE_BG);
            expect(fg).toBe(INACTIVE_FG);
        });
    });

    describe("hover", () => {
        it("uses hoverBg for hovered non-cursor row", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            tree.focus();
            app.render();

            // Move mouse to row 1 (Beta) — mouse tokens use 1-based coordinates
            app.backend.simulateMouse(makeMouseToken({ action: "move", x: 4, y: 2 }));
            app.render();

            const bg = app.backend.getBgAt(new Point(0, 1));
            expect(bg).toBe(HOVER_BG);
        });

        it("cursor row takes priority over hover", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            tree.focus();
            app.render();

            // Move mouse to row 0 (cursor row) — 1-based coords
            app.backend.simulateMouse(makeMouseToken({ action: "move", x: 4, y: 1 }));
            app.render();

            const bg = app.backend.getBgAt(new Point(0, 0));
            expect(bg).toBe(ACTIVE_BG);
        });

        it("clears hover on mouseleave", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            tree.focus();
            app.render();

            // Hover row 1 — 1-based coords
            app.backend.simulateMouse(makeMouseToken({ action: "move", x: 4, y: 2 }));
            app.render();
            expect(app.backend.getBgAt(new Point(0, 1))).toBe(HOVER_BG);

            // Move mouse to row beyond content (row index 4 = screen y=4, token y=5)
            app.backend.simulateMouse(makeMouseToken({ action: "move", x: 4, y: 5 }));
            app.render();

            // Row 1 should no longer have hover bg
            const bg = app.backend.getBgAt(new Point(0, 1));
            expect(bg).not.toBe(HOVER_BG);
        });
    });

    describe("cut items", () => {
        it("uses cutFg for items in cut set", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            tree.focus();
            tree.setCutKeys(new Set(["b"])); // Beta is cut
            app.render();

            // Row 1 (Beta) should have cutFg for text
            const fg = app.backend.getFgAt(new Point(3, 1)); // "B" in "Beta"
            expect(fg).toBe(CUT_FG);
        });

        it("cursor row takes priority over cut styling", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            tree.focus();
            tree.setCutKeys(new Set(["a"])); // Alpha is both cursor and cut
            app.render();

            // Row 0 (Alpha) — cursor row, focused → should use activeSelectionFg, not cutFg
            const fg = app.backend.getFgAt(new Point(3, 0));
            expect(fg).toBe(ACTIVE_FG);
        });

        it("clearCutKeys removes cut styling", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            tree.focus();
            tree.setCutKeys(new Set(["b"]));
            app.render();
            expect(app.backend.getFgAt(new Point(3, 1))).toBe(CUT_FG);

            tree.clearCutKeys();
            app.render();
            const fg = app.backend.getFgAt(new Point(3, 1));
            expect(fg).not.toBe(CUT_FG);
        });
    });

    describe("focus transitions", () => {
        it("switches from active to inactive colors when focus is lost", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            tree.focus();
            app.render();

            expect(app.backend.getBgAt(new Point(0, 0))).toBe(ACTIVE_BG);

            tree.blur();
            app.render();

            expect(app.backend.getBgAt(new Point(0, 0))).toBe(INACTIVE_BG);
        });

        it("switches from inactive to active colors when focus is gained", async () => {
            const { tree, app } = createTree(FLAT_TREE);
            await tree.refresh();
            // Tree starts unfocused
            app.render();

            expect(app.backend.getBgAt(new Point(0, 0))).toBe(INACTIVE_BG);

            tree.focus();
            app.render();

            expect(app.backend.getBgAt(new Point(0, 0))).toBe(ACTIVE_BG);
        });
    });
});
