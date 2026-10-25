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

describe("Workbench — sash hover feedback", () => {
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

    /** The sidebar sash's middle cell on screen. */
    function sidebarSashCell(): Point {
        const sash = findSashes(h.testApp.root).find((s) => !s.hidden);
        if (sash === undefined) throw new Error("no visible sash");
        return new Point(sash.globalPosition.x, sash.globalPosition.y + Math.floor(sash.layoutSize.height / 2));
    }

    function isLit(cell: Point): boolean {
        const color = h.container.get(ThemeServiceDIToken).theme.getRequiredColor("sash.hoverBorder");
        return h.testApp.backend.getTextAt(cell, 1) === "│" && h.testApp.backend.getFgAt(cell) === color;
    }

    function hoverAt(cell: Point): void {
        h.testApp.backend.simulateMouse(hover(cell.x, cell.y));
        h.testApp.render();
    }

    it("lights the sidebar sash in the frame right after the hover by default", () => {
        boot();
        const cell = sidebarSashCell();
        expect(isLit(cell)).toBe(false);

        hoverAt(cell);
        expect(isLit(cell)).toBe(true);

        // Leaving puts it out.
        hoverAt(new Point(cell.x + 10, cell.y));
        expect(isLit(cell)).toBe(false);
    });

    it("waits `workbench.sash.hoverDelay` before lighting it", () => {
        vi.useFakeTimers();
        boot({ "workbench.sash.hoverDelay": 300 });
        const cell = sidebarSashCell();

        hoverAt(cell);
        expect(isLit(cell)).toBe(false);
        vi.advanceTimersByTime(299);
        h.testApp.render();
        expect(isLit(cell)).toBe(false);
        vi.advanceTimersByTime(1);
        h.testApp.render();
        expect(isLit(cell)).toBe(true);
    });

    it("applies a changed delay live, from the next hover", async () => {
        vi.useFakeTimers();
        boot();
        const cell = sidebarSashCell();
        await configuration.updateValue("workbench.sash.hoverDelay", 1000);

        hoverAt(cell);
        expect(isLit(cell)).toBe(false);
        vi.advanceTimersByTime(1000);
        h.testApp.render();
        expect(isLit(cell)).toBe(true);

        hoverAt(new Point(cell.x + 10, cell.y));
        await configuration.updateValue("workbench.sash.hoverDelay", 0);
        hoverAt(cell);
        expect(isLit(cell)).toBe(true);
    });

    it("a hidden sidebar's sash does not light up, and lights again once the sidebar is back", async () => {
        boot();
        const cell = sidebarSashCell();

        await h.commands.execute("workbench.action.toggleSidebarVisibility");
        h.testApp.render();
        hoverAt(cell);
        expect(isLit(cell)).toBe(false);

        await h.commands.execute("workbench.action.toggleSidebarVisibility");
        hoverAt(new Point(cell.x + 10, cell.y));
        hoverAt(cell);
        expect(isLit(cell)).toBe(true);
    });

    it("falls back to the instant default for a value outside the schema", () => {
        boot({ "workbench.sash.hoverDelay": 5000 });
        const cell = sidebarSashCell();

        hoverAt(cell);
        expect(isLit(cell)).toBe(true);
    });
});
