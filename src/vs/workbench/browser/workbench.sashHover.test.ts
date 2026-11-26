import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { SashElement } from "@tuidom/elements/sash/sashElement";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import type { InMemoryConfigurationService } from "../../platform/configuration/common/inMemoryConfigurationService.ts";
import { ThemeServiceDIToken } from "../services/themes/common/themeTokens.ts";

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

describe("Workbench — sash hover feedback (framed parts: the pointer shape, no line)", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let configuration: InMemoryConfigurationService;

    function boot(settings: Readonly<Record<string, unknown>> = {}): void {
        ws = createTempWorkspace({ prefix: "diode-sash-hover-", files: { "a.txt": "alpha\n" } });
        configuration = createTestConfigurationService(settings);
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("a.txt"),
            size: new Size(80, 20),
            configurationService: configuration,
        });
        h.testApp.render();
    }

    afterEach(() => {
        vi.useRealTimers();
        h.dispose();
        ws.dispose();
    });

    function sidebarSash(): SashElement {
        const sash = findSashes(h.testApp.root).find((s) => !s.hidden);
        if (sash === undefined) throw new Error("no visible sash");
        return sash;
    }

    /** The sidebar sash's middle row on screen: its two cells, over both frame lines at the boundary. */
    function sidebarSashCells(): Point[] {
        const sash = sidebarSash();
        const y = sash.globalPosition.y + Math.floor(sash.layoutSize.height / 2);
        return Array.from({ length: sash.layoutSize.width }, (_, i) => new Point(sash.globalPosition.x + i, y));
    }

    /** What the cells show: glyph and colour, to compare before and after a hover. */
    function look(cells: readonly Point[]): string[] {
        return cells.map((cell) => `${h.testApp.backend.getTextAt(cell, 1)}:${h.testApp.backend.getFgAt(cell)}`);
    }

    function hoverColor(): number {
        return h.container.get(ThemeServiceDIToken).theme.getRequiredColor("sash.hoverBorder");
    }

    /** The cells keep the two frame lines: no hover line is drawn over them. */
    function expectNoHoverLine(cells: readonly Point[], before: readonly string[]): void {
        expect(look(cells)).toEqual(before);
        expect(cells.map((cell) => h.testApp.backend.getTextAt(cell, 1))).toEqual(["│", "│"]);
        for (const cell of cells) expect(h.testApp.backend.getFgAt(cell)).not.toBe(hoverColor());
    }

    function hoverAt(cell: Point): void {
        h.testApp.backend.simulateMouse(hover(cell.x, cell.y));
        h.testApp.render();
    }

    // The sidebar sash lies over both frame lines at the boundary: the lines already show it, so
    // no hover line lights up on it — only the mouse pointer turns into the resize arrow.
    it("the sidebar sash draws no hover line over the frame lines; only the pointer turns into the resize arrow", () => {
        boot();
        const cells = sidebarSashCells();
        const before = look(cells);

        for (const cell of cells) {
            hoverAt(cell);
            expectNoHoverLine(cells, before);
            expect(h.testApp.backend.pointerShape).toBe("ew-resize");
        }

        // Leaving gives the pointer back.
        hoverAt(new Point(cells[0].x + 10, cells[0].y));
        expect(h.testApp.backend.pointerShape).not.toBe("ew-resize");
        expectNoHoverLine(cells, before);
    });

    it("`workbench.sash.hoverDelay` reaches the sash, and no line shows after the delay either", () => {
        vi.useFakeTimers();
        boot({ "workbench.sash.hoverDelay": 300 });
        expect(sidebarSash().hoverDelay).toBe(300);
        const cells = sidebarSashCells();
        const before = look(cells);

        hoverAt(cells[0]);
        vi.advanceTimersByTime(300);
        h.testApp.render();
        expectNoHoverLine(cells, before);
        expect(h.testApp.backend.pointerShape).toBe("ew-resize");
    });

    it("applies a changed delay live", async () => {
        vi.useFakeTimers();
        boot();
        expect(sidebarSash().hoverDelay).toBe(0);
        await configuration.updateValue("workbench.sash.hoverDelay", 1000);
        expect(sidebarSash().hoverDelay).toBe(1000);

        const cells = sidebarSashCells();
        const before = look(cells);
        hoverAt(cells[0]);
        vi.advanceTimersByTime(1000);
        h.testApp.render();
        expectNoHoverLine(cells, before);

        await configuration.updateValue("workbench.sash.hoverDelay", 0);
        expect(sidebarSash().hoverDelay).toBe(0);
    });

    it("a hidden sidebar's sash gives no resize arrow, and gives it again once the sidebar is back", async () => {
        boot();
        const cells = sidebarSashCells();

        await h.commands.execute("workbench.action.toggleSidebarVisibility");
        h.testApp.render();
        hoverAt(cells[0]);
        expect(h.testApp.backend.pointerShape).not.toBe("ew-resize");
        for (const cell of cells) expect(h.testApp.backend.getFgAt(cell)).not.toBe(hoverColor());

        await h.commands.execute("workbench.action.toggleSidebarVisibility");
        hoverAt(new Point(cells[0].x + 10, cells[0].y));
        const before = look(cells);
        hoverAt(cells[0]);
        expect(h.testApp.backend.pointerShape).toBe("ew-resize");
        expectNoHoverLine(cells, before);
    });

    it("falls back to the instant default for a value outside the schema", () => {
        boot({ "workbench.sash.hoverDelay": 5000 });
        expect(sidebarSash().hoverDelay).toBe(0);
        const cells = sidebarSashCells();
        const before = look(cells);

        hoverAt(cells[0]);
        expectNoHoverLine(cells, before);
    });
});
