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

describe("Workbench — sash hover feedback, edges", () => {
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

    function visibleSashes(): SashElement[] {
        return findSashes(h.testApp.root).filter((s) => !s.hidden);
    }

    /** A sash's middle row (vertical) or column (horizontal): all its cells across its thickness. */
    function sashCells(sash: SashElement): Point[] {
        const { x, y } = sash.globalPosition;
        const { width, height } = sash.layoutSize;
        return sash.pointerShape === "ew-resize"
            ? Array.from({ length: width }, (_, i) => new Point(x + i, y + Math.floor(height / 2)))
            : Array.from({ length: height }, (_, i) => new Point(x + Math.floor(width / 2), y + i));
    }

    function sidebarSashCells(): Point[] {
        const sash = visibleSashes().at(0);
        if (sash === undefined) throw new Error("no visible sash");
        return sashCells(sash);
    }

    function look(cells: readonly Point[]): string[] {
        return cells.map((cell) => `${h.testApp.backend.getTextAt(cell, 1)}:${h.testApp.backend.getFgAt(cell)}`);
    }

    function hoverColor(): number {
        return h.container.get(ThemeServiceDIToken).theme.getRequiredColor("sash.hoverBorder");
    }

    function expectNoHoverColor(cells: readonly Point[]): void {
        for (const cell of cells) expect(h.testApp.backend.getFgAt(cell)).not.toBe(hoverColor());
    }

    function hoverAt(cell: Point): void {
        h.testApp.backend.simulateMouse(hover(cell.x, cell.y));
        h.testApp.render();
    }

    function press(cell: Point, action: "press" | "move" | "release"): void {
        h.testApp.backend.simulateMouse({ ...hover(cell.x, cell.y), button: "left", action });
        h.testApp.render();
    }

    it("a drag draws no line either: the boundary moves, its frame lines stay, the pointer keeps the arrow", () => {
        vi.useFakeTimers();
        boot({ "workbench.sash.hoverDelay": 2000 });
        const cells = sidebarSashCells();
        const before = look(cells);
        hoverAt(cells[0]);
        expect(look(cells)).toEqual(before);

        press(cells[0], "press");
        press(new Point(cells[0].x + 2, cells[0].y), "move");
        const moved = sidebarSashCells();
        expect(moved[0].x).toBe(cells[0].x + 2);
        // The sash's cells now show the moved frame lines, not a hover line.
        expect(look(moved)).toEqual(before);
        expectNoHoverColor(moved);
        expect(h.testApp.backend.pointerShape).toBe("ew-resize");
        press(new Point(cells[0].x + 2, cells[0].y), "release");
    });

    it("leaving before the delay never lights it", () => {
        vi.useFakeTimers();
        boot({ "workbench.sash.hoverDelay": 300 });
        const cells = sidebarSashCells();
        const before = look(cells);
        hoverAt(cells[0]);
        vi.advanceTimersByTime(200);
        hoverAt(new Point(cells[0].x + 10, cells[0].y));
        vi.advanceTimersByTime(1000);
        h.testApp.render();
        expect(look(cells)).toEqual(before);
        expectNoHoverColor(cells);
    });

    it("a hover pending when the setting drops to 0 still draws no line; the sash takes the new delay", async () => {
        vi.useFakeTimers();
        boot({ "workbench.sash.hoverDelay": 1000 });
        const cells = sidebarSashCells();
        const before = look(cells);
        hoverAt(cells[0]);
        await configuration.updateValue("workbench.sash.hoverDelay", 0);
        expect(visibleSashes()[0].hoverDelay).toBe(0);
        h.testApp.render();
        expect(look(cells)).toEqual(before);
        vi.advanceTimersByTime(1000);
        h.testApp.render();
        expect(look(cells)).toEqual(before);
        expectNoHoverColor(cells);
    });

    it("a hover pending when the setting grows still draws no line; the sash takes the new delay", async () => {
        vi.useFakeTimers();
        boot({ "workbench.sash.hoverDelay": 300 });
        const cells = sidebarSashCells();
        const before = look(cells);
        hoverAt(cells[0]);
        await configuration.updateValue("workbench.sash.hoverDelay", 2000);
        expect(visibleSashes()[0].hoverDelay).toBe(2000);
        vi.advanceTimersByTime(300);
        h.testApp.render();
        expect(look(cells)).toEqual(before);
        expectNoHoverColor(cells);
    });

    it("the panel and secondary side bar sashes get the delay too, and show no line either", async () => {
        vi.useFakeTimers();
        boot({ "workbench.sash.hoverDelay": 300 });
        await h.commands.execute("workbench.action.togglePanel");
        await h.commands.execute("workbench.action.toggleAuxiliaryBar");
        h.testApp.render();
        const sashes = visibleSashes();
        expect(sashes.length).toBe(3);
        for (const s of sashes) {
            expect(s.hoverDelay).toBe(300);
            const cells = sashCells(s);
            hoverAt(new Point(0, 0));
            const before = look(cells);
            hoverAt(cells[0]);
            expect(h.testApp.backend.pointerShape).toBe(s.pointerShape === "ew-resize" ? "ew-resize" : "ns-resize");
            vi.advanceTimersByTime(300);
            h.testApp.render();
            expect(look(cells)).toEqual(before);
            expectNoHoverColor(cells);
        }
    });
});
