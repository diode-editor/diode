import { compositeOver } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { TAB_HEIGHT } from "@tuidom/elements/editorgroup/editorTabItemElement";
import { SashElement } from "@tuidom/elements/sash/sashElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { WorkbenchTheme } from "../../platform/theme/common/workbenchTheme.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";
import { darkModernTheme } from "../services/themes/common/themes/darkModern.ts";
import { monokaiTheme } from "../services/themes/common/themes/monokai.ts";
import { ThemeServiceDIToken } from "../services/themes/common/themeTokens.ts";

import { EditorPartComponentDIToken } from "./parts/editor/editorPartComponent.ts";

/** A move with no button held, as any-motion tracking reports a hover (0-based screen cell). */
function hover(x: number, y: number): MouseToken {
    return {
        kind: "mouse",
        button: "none",
        action: "move",
        x: x + 1,
        y: y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

function findSashes(element: TUIElement): SashElement[] {
    const own = element instanceof SashElement ? [element] : [];
    return [...own, ...element.getChildren().flatMap(findSashes)];
}

// Every editor group frames itself (docs/arch/workbench/Frames.md): the boundary between two groups is
// the two frame lines side by side — no separator cell of its own — and the 2-cell sash lies over both.
describe("Workbench — boundary between editor groups", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-group-separator-", files: { "a.txt": "alpha\nbeta\ngamma\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: ws.path("a.txt"), size: new Size(120, 30) });
        h.testApp.render();
    });

    afterEach(() => {
        vi.useRealTimers();
        h.dispose();
        ws.dispose();
    });

    function part(): TUIElement {
        return h.container.get(EditorPartComponentDIToken).view;
    }

    function groupSashes(): SashElement[] {
        return findSashes(part()).filter((s) => !s.hidden);
    }

    function groupViews(): TUIElement[] {
        const views = part()
            .getChildren()
            .filter((child) => !(child instanceof SashElement));
        expect(views).toHaveLength(h.container.get(EditorServiceDIToken).editorGroups.groups.length);
        return views;
    }

    function themeColor(key: "panel.border" | "editorGroup.border" | "sash.hoverBorder" | "editor.background"): number {
        return h.container.get(ThemeServiceDIToken).theme.getRequiredColor(key);
    }

    /** The glyph over the editor background, its color composed over it — how alpha colors land on screen. */
    function drawnIn(cell: Point, glyph: string, color: number): boolean {
        const backend = h.testApp.backend;
        const bg = themeColor("editor.background");
        return (
            backend.getTextAt(cell, 1) === glyph &&
            backend.getBgAt(cell) === bg &&
            backend.getFgAt(cell) === compositeOver(color, bg)
        );
    }

    /** Rows of the groups' bodies: below the 3-row tabs, above the frame's bottom line. */
    function bodyRows(): number[] {
        const top = part().globalPosition.y + TAB_HEIGHT;
        const bottom = part().globalPosition.y + part().layoutSize.height - 1;
        return Array.from({ length: bottom - top }, (_, i) => top + i);
    }

    /** Both frame lines of a column boundary whose second cell (the right group's left side) is at `x`. */
    function expectBoundaryAt(x: number, color = themeColor("panel.border")): void {
        for (const y of bodyRows()) {
            expect(drawnIn(new Point(x - 1, y), "│", color), `left line, row ${y}`).toBe(true);
            expect(drawnIn(new Point(x, y), "│", color), `right line, row ${y}`).toBe(true);
        }
        const bottom = part().globalPosition.y + part().layoutSize.height - 1;
        expect(h.testApp.backend.getTextAt(new Point(x - 1, bottom), 2)).toBe("╯╰");
    }

    async function run(command: string): Promise<void> {
        await h.commands.execute(command);
        h.testApp.render();
    }

    it("a single group has no sash", () => {
        expect(groupSashes()).toEqual([]);
    });

    it("split right: the groups stand side by side, the boundary is their two frame lines under a 2-cell sash", async () => {
        await run("workbench.action.splitEditor");

        const [sash] = groupSashes();
        const [left, right] = groupViews();
        // No separator cell: the right group starts right where the left one ends.
        expect(left.globalPosition.x + left.layoutSize.width).toBe(right.globalPosition.x);
        // The sash covers both lines: the left group's last column and the right group's first.
        expect(sash.globalPosition.x).toBe(right.globalPosition.x - 1);
        expect(sash.layoutSize.width).toBe(2);
        expect(sash.layoutSize.height).toBe(part().layoutSize.height);
        expectBoundaryAt(right.globalPosition.x);
    });

    it("the frame lines take the theme's panel.border, not editorGroup.border", async () => {
        await run("workbench.action.splitEditor");
        const x = groupViews()[1].globalPosition.x;

        for (const file of [monokaiTheme, darkModernTheme]) {
            h.container.get(ThemeServiceDIToken).setTheme(WorkbenchTheme.fromThemeFile(file));
            h.testApp.render();
            expectBoundaryAt(x);
        }
        // Dark Modern's editorGroup.border (#FFFFFF17) differs from its panel.border: the old separator color is gone.
        expect(h.testApp.backend.getFgAt(new Point(x, bodyRows()[0]))).not.toBe(
            compositeOver(themeColor("editorGroup.border"), themeColor("editor.background")),
        );
    });

    it("hovering the sash shows no hover line — only the resize pointer; the frame lines stay as they are", async () => {
        await run("workbench.action.splitEditor");
        const [sash] = groupSashes();
        const x = groupViews()[1].globalPosition.x;
        const cell = new Point(sash.globalPosition.x, sash.globalPosition.y + 5);

        vi.useFakeTimers();
        h.testApp.backend.simulateMouse(hover(cell.x, cell.y));
        h.testApp.render();
        expect(h.testApp.backend.pointerShape).toBe("ew-resize");
        // Past the engine's 300 ms hover delay nothing lights up.
        vi.advanceTimersByTime(300);
        h.testApp.render();
        expectBoundaryAt(x);
        expect(h.testApp.backend.pointerShape).toBe("ew-resize");

        h.testApp.backend.simulateMouse(hover(cell.x + 10, cell.y));
        h.testApp.render();
        expect(h.testApp.backend.pointerShape).toBe("default");
        expectBoundaryAt(x);
    });

    it("dragging the right group's frame line puts it under the cursor", async () => {
        await run("workbench.action.splitEditor");
        const [sash] = groupSashes();
        // The sash's second cell is the right group's left line.
        const from = new Point(sash.globalPosition.x + 1, sash.globalPosition.y + 5);
        const to = from.x + 7;

        const press = (action: MouseToken["action"], x: number): void => {
            h.testApp.backend.simulateMouse({ ...hover(x, from.y), button: "left", action });
            h.testApp.render();
        };
        press("press", from.x);
        press("move", to);
        // The groups follow the drag live; no hover line is painted over them.
        expectBoundaryAt(to);
        press("release", to);

        expect(groupViews()[1].globalPosition.x).toBe(to);
        expect(groupSashes()[0].globalPosition.x).toBe(to - 1);
        expectBoundaryAt(to);
    });

    it("toggle layout: the boundary is the upper frame's bottom line over the lower group's tabs, no row of its own", async () => {
        await run("workbench.action.splitEditor");
        await run("workbench.action.toggleEditorGroupLayout");

        const [sash] = groupSashes();
        const [top, bottom] = groupViews();
        const y = top.globalPosition.y + top.layoutSize.height - 1;
        expect(bottom.globalPosition.y).toBe(y + 1);
        expect(sash.globalPosition.y).toBe(y);
        expect(sash.layoutSize.height).toBe(2);
        expect(sash.layoutSize.width).toBe(part().layoutSize.width);
        const x0 = part().globalPosition.x;
        const width = part().layoutSize.width;
        expect(h.testApp.backend.getTextAt(new Point(x0, y), width)).toBe(`╰${"─".repeat(width - 2)}╯`);
        // The lower group's tabs start on the next row: its first tab's top is there.
        expect(bottom.querySelector("EditorTabStripElement")!.globalPosition.y).toBe(y + 1);
        expect(h.testApp.backend.getTextAt(new Point(x0, y + 1), 1)).toBe("╭");
    });

    it("a maximized group spans the whole part without a boundary, restoring brings it back", async () => {
        await run("workbench.action.splitEditor");
        const x = groupViews()[1].globalPosition.x;
        const row = bodyRows()[0];

        await run("workbench.action.toggleMaximizeEditorGroup");
        expect(groupSashes()).toEqual([]);
        expect(h.testApp.backend.getTextAt(new Point(x - 1, row), 2)).not.toContain("│");

        await run("workbench.action.toggleMaximizeEditorGroup");
        expect(groupViews()[1].globalPosition.x).toBe(x);
        expect(groupSashes()[0].globalPosition.x).toBe(x - 1);
        expectBoundaryAt(x);
    });

    it("closing a group removes its sash and gives the width to the neighbor", async () => {
        await run("workbench.action.splitEditor");
        await run("workbench.action.closeEditorsAndGroup");

        expect(groupSashes()).toEqual([]);
        expect(groupViews()[0].layoutSize.width).toBe(part().layoutSize.width);
    });
});
