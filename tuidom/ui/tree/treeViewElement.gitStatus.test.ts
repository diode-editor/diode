import { describe, expect, it } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import { RenderContext } from "../../dom/tuiElement.ts";
import { TerminalScreen } from "../../rendering/terminalScreen.ts";

import type { ITreeDataProvider, ITreeItem } from "./iTreeDataProvider.ts";
import { TreeViewElement, unthemedTreeViewStyles } from "./treeViewElement.ts";

interface TestNode {
    id: string;
    label: string;
    labelColor?: number;
    badge?: string;
    symlink?: boolean;
    icon?: string;
    iconColor?: number;
}

function createProvider(roots: TestNode[]): ITreeDataProvider<TestNode> {
    return {
        getTreeItem(element: TestNode): ITreeItem {
            return {
                label: element.label,
                collapsible: false,
                labelColor: element.labelColor,
                badge: element.badge,
                symlink: element.symlink,
                icon: element.icon,
                iconColor: element.iconColor,
            };
        },
        getChildren(element?: TestNode): TestNode[] {
            return element ? [] : roots;
        },
        getKey(element: TestNode): string {
            return element.id;
        },
    };
}

function renderTree(tree: TreeViewElement<TestNode>, width: number, height: number): MockTerminalBackend {
    const size = new Size(width, height);
    const backend = new MockTerminalBackend(size);
    const termScreen = new TerminalScreen(size);
    tree.localPosition = new Offset(0, 0);
    tree.performLayout(BoxConstraints.tight(size));
    const clipRect = new Rect(new Point(0, 0), size);
    tree.render(new RenderContext(termScreen, new Offset(0, 0), clipRect));
    termScreen.flush(backend);
    return backend;
}

const GIT_MODIFIED = packRgb(115, 201, 145);
const ACTIVE_FG = packRgb(255, 255, 255);
const ACTIVE_BG = packRgb(4, 57, 94);

describe("TreeViewElement git-status decorations", () => {
    describe("label colour", () => {
        it("overrides the name span fg with labelColor on a non-selected row", async () => {
            const tree = new TreeViewElement(
                createProvider([
                    { id: "a", label: "Alpha" },
                    { id: "b", label: "Beta", labelColor: GIT_MODIFIED },
                ]),
            );
            await tree.refresh();

            const backend = renderTree(tree, 14, 2);
            // Row 1 (Beta) is not the cursor → its name is git-coloured. Label starts at
            // col 2 ("  Beta"), so the "B" carries the decoration colour.
            expect(backend.getFgAt(new Point(2, 1))).toBe(GIT_MODIFIED);
            // Row 0 (Alpha) has no decoration → default fg, not the git colour.
            expect(backend.getFgAt(new Point(2, 0))).not.toBe(GIT_MODIFIED);
        });

        it("does not colour the leading indent/expand column, only the label", async () => {
            const tree = new TreeViewElement(
                createProvider([
                    { id: "a", label: "Alpha" },
                    { id: "b", label: "Beta", labelColor: GIT_MODIFIED },
                ]),
            );
            await tree.refresh();

            const backend = renderTree(tree, 14, 2);
            // Columns 0/1 are the expand-icon slot + separating space, before labelStart.
            expect(backend.getFgAt(new Point(0, 1))).not.toBe(GIT_MODIFIED);
        });

        it("keeps the type icon its own colour while colouring the label", async () => {
            const iconColor = packRgb(80, 160, 220);
            const tree = new TreeViewElement(
                createProvider([
                    { id: "cursor", label: "x.ts" },
                    { id: "f", label: "a.ts", icon: "T", iconColor, labelColor: GIT_MODIFIED },
                ]),
            );
            await tree.refresh();

            const backend = renderTree(tree, 14, 2);
            // Row 1 (non-cursor): "  T a.ts" → icon "T" at col 2, label starts at col 4.
            expect(backend.getFgAt(new Point(2, 1))).toBe(iconColor);
            expect(backend.getFgAt(new Point(4, 1))).toBe(GIT_MODIFIED);
        });

        it("yields to the selection foreground on the focused cursor row", async () => {
            const tree = new TreeViewElement(createProvider([{ id: "a", label: "Alpha", labelColor: GIT_MODIFIED }]));
            tree.setStyles({ ...unthemedTreeViewStyles, activeSelectionBg: ACTIVE_BG, activeSelectionFg: ACTIVE_FG });
            await tree.refresh();
            const app = TestApp.createWithContent(tree, new Size(14, 1));
            tree.focus();
            app.render();

            // Cursor row selected + focused → the selection fg wins for readability.
            expect(app.backend.getFgAt(new Point(2, 0))).toBe(ACTIVE_FG);
        });
    });

    describe("badge", () => {
        it("draws a one-letter badge pinned to the rightmost column in the label colour", async () => {
            const tree = new TreeViewElement(
                createProvider([{ id: "a", label: "Alpha", badge: "M", labelColor: GIT_MODIFIED }]),
            );
            await tree.refresh();
            tree.blur();

            const width = 14;
            const backend = renderTree(tree, width, 1);
            const line = backend.screenToString().split("\n")[0];
            expect(line[width - 1]).toBe("M");
            expect(backend.getFgAt(new Point(width - 1, 0))).toBe(GIT_MODIFIED);
        });

        it("right-aligns a two-character badge across the two rightmost columns", async () => {
            const tree = new TreeViewElement(createProvider([{ id: "a", label: "Alpha", badge: "AM" }]));
            await tree.refresh();

            const width = 14;
            const backend = renderTree(tree, width, 1);
            const line = backend.screenToString().split("\n")[0];
            expect(line[width - 2]).toBe("A");
            expect(line[width - 1]).toBe("M");
        });

        it("clips a badge that would overflow a very narrow viewport", async () => {
            // Width 1 with a two-char badge: the first badge column lands at x = -1
            // (clipped) while the second lands at x = 0 (drawn). Exercises the edge
            // guard without corrupting the frame.
            const tree = new TreeViewElement(createProvider([{ id: "a", label: "Alpha", badge: "AM", symlink: true }]));
            await tree.refresh();

            const backend = renderTree(tree, 1, 1);
            const line = backend.screenToString().split("\n")[0];
            // Only the last badge char fits; the symlink arrow (further left) is clipped off.
            expect(line[0]).toBe("M");
        });

        it("does not draw a badge when the item has none", async () => {
            const tree = new TreeViewElement(createProvider([{ id: "a", label: "Alpha" }]));
            await tree.refresh();

            const width = 14;
            const backend = renderTree(tree, width, 1);
            const line = backend.screenToString().split("\n")[0];
            expect(line[width - 1]).toBe(" ");
        });
    });

    describe("badge + symlink coexistence", () => {
        it("keeps the git badge at the edge and shifts the symlink arrow left of it", async () => {
            const tree = new TreeViewElement(createProvider([{ id: "a", label: "Alpha", badge: "M", symlink: true }]));
            tree.setStyles({ ...unthemedTreeViewStyles, symlinkFg: packRgb(120, 120, 120) });
            await tree.refresh();

            const width = 14;
            const backend = renderTree(tree, width, 1);
            const line = backend.screenToString().split("\n")[0];
            // Git badge owns the last column; the symlink arrow sits just left of it.
            expect(line[width - 1]).toBe("M");
            expect(line[width - 2]).toBe("↵");
            expect(backend.getFgAt(new Point(width - 2, 0))).toBe(packRgb(120, 120, 120));
        });
    });
});
