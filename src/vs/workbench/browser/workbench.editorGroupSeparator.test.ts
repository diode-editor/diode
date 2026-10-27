import { compositeOver } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
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

describe("Workbench — separator between editor groups", () => {
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

    function themeColor(key: "editorGroup.border" | "sash.hoverBorder" | "editor.background"): number {
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

    async function run(command: string): Promise<void> {
        await h.commands.execute(command);
        h.testApp.render();
    }

    it("a single group has no separator", () => {
        expect(groupSashes()).toEqual([]);
    });

    it("split right: a column of │ in editorGroup.border between the groups, which do not cover it", async () => {
        await run("workbench.action.splitEditor");

        const [sash] = groupSashes();
        const [left, right] = groupViews();
        const x = sash.globalPosition.x;
        expect(left.globalPosition.x + left.layoutSize.width).toBe(x);
        expect(right.globalPosition.x).toBe(x + 1);
        for (let y = part().globalPosition.y; y < part().globalPosition.y + part().layoutSize.height; y++) {
            expect(drawnIn(new Point(x, y), "│", themeColor("editorGroup.border")), `row ${y}`).toBe(true);
        }
    });

    it("takes the theme's editorGroup.border, an alpha one blended over the editor background", async () => {
        await run("workbench.action.splitEditor");
        const cell = new Point(groupSashes()[0].globalPosition.x, part().globalPosition.y + 2);

        for (const file of [monokaiTheme, darkModernTheme]) {
            h.container.get(ThemeServiceDIToken).setTheme(WorkbenchTheme.fromThemeFile(file));
            h.testApp.render();
            expect(drawnIn(cell, "│", themeColor("editorGroup.border")), file.name).toBe(true);
        }
        // Dark Modern's #FFFFFF17 is a faint line over #1F1F1F, not white.
        expect(h.testApp.backend.getFgAt(cell)).not.toBe(themeColor("editorGroup.border"));
    });

    it("hovering the separator repaints it in sash.hoverBorder, leaving restores editorGroup.border", async () => {
        await run("workbench.action.splitEditor");
        const [sash] = groupSashes();
        const cell = new Point(sash.globalPosition.x, sash.globalPosition.y + 5);

        vi.useFakeTimers();
        h.testApp.backend.simulateMouse(hover(cell.x, cell.y));
        h.testApp.render();
        expect(drawnIn(cell, "│", themeColor("editorGroup.border"))).toBe(true);
        // Group sashes keep the engine's 300 ms; workbench.sash.hoverDelay covers the shell sashes.
        vi.advanceTimersByTime(300);
        h.testApp.render();
        expect(drawnIn(cell, "│", themeColor("sash.hoverBorder"))).toBe(true);

        h.testApp.backend.simulateMouse(hover(cell.x + 10, cell.y));
        h.testApp.render();
        expect(drawnIn(cell, "│", themeColor("editorGroup.border"))).toBe(true);
    });

    it("dragging the separator puts it under the cursor", async () => {
        await run("workbench.action.splitEditor");
        const [sash] = groupSashes();
        const from = new Point(sash.globalPosition.x, sash.globalPosition.y + 5);
        const to = from.x + 7;

        const press = (action: MouseToken["action"], x: number): void => {
            h.testApp.backend.simulateMouse({ ...hover(x, from.y), button: "left", action });
            h.testApp.render();
        };
        press("press", from.x);
        press("move", to);
        expect(drawnIn(new Point(to, from.y), "│", themeColor("sash.hoverBorder"))).toBe(true);
        press("release", to);

        expect(groupSashes()[0].globalPosition.x).toBe(to);
        expect(groupViews()[1].globalPosition.x).toBe(to + 1);
        expect(drawnIn(new Point(to, from.y), "│", themeColor("editorGroup.border"))).toBe(true);
    });

    it("toggle layout: the separator becomes a row of ─ that eats neither group's rows", async () => {
        await run("workbench.action.splitEditor");
        await run("workbench.action.toggleEditorGroupLayout");

        const [sash] = groupSashes();
        const [top, bottom] = groupViews();
        const y = sash.globalPosition.y;
        expect(top.globalPosition.y + top.layoutSize.height).toBe(y);
        expect(bottom.globalPosition.y).toBe(y + 1);
        for (let x = part().globalPosition.x; x < part().globalPosition.x + part().layoutSize.width; x++) {
            expect(drawnIn(new Point(x, y), "─", themeColor("editorGroup.border")), `column ${x}`).toBe(true);
        }
    });

    it("a maximized group spans the whole part without a separator, restoring brings it back", async () => {
        await run("workbench.action.splitEditor");
        const x = groupSashes()[0].globalPosition.x;

        await run("workbench.action.toggleMaximizeEditorGroup");
        expect(groupSashes()).toEqual([]);
        expect(h.testApp.backend.getTextAt(new Point(x, part().globalPosition.y + 3), 1)).not.toBe("│");

        await run("workbench.action.toggleMaximizeEditorGroup");
        expect(groupSashes()[0].globalPosition.x).toBe(x);
        expect(drawnIn(new Point(x, part().globalPosition.y + 3), "│", themeColor("editorGroup.border"))).toBe(true);
    });

    it("closing a group removes its separator and gives the width to the neighbor", async () => {
        await run("workbench.action.splitEditor");
        await run("workbench.action.closeEditorsAndGroup");

        expect(groupSashes()).toEqual([]);
        expect(groupViews()[0].layoutSize.width).toBe(part().layoutSize.width);
    });
});
