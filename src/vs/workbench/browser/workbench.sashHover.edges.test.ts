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

    function press(cell: Point, action: "press" | "move" | "release"): void {
        h.testApp.backend.simulateMouse({ ...hover(cell.x, cell.y), button: "left", action });
        h.testApp.render();
    }

    it("a drag lights the sash even before a long delay runs out", () => {
        vi.useFakeTimers();
        boot({ "workbench.sash.hoverDelay": 2000 });
        const cell = sidebarSashCell();
        hoverAt(cell);
        expect(isLit(cell)).toBe(false);

        press(cell, "press");
        press(new Point(cell.x + 2, cell.y), "move");
        expect(isLit(sidebarSashCell())).toBe(true);
        press(new Point(cell.x + 2, cell.y), "release");
    });

    it("leaving before the delay never lights it", () => {
        vi.useFakeTimers();
        boot({ "workbench.sash.hoverDelay": 300 });
        const cell = sidebarSashCell();
        hoverAt(cell);
        vi.advanceTimersByTime(200);
        hoverAt(new Point(cell.x + 10, cell.y));
        vi.advanceTimersByTime(1000);
        h.testApp.render();
        expect(isLit(cell)).toBe(false);
    });

    it("a show already pending keeps its delay when the setting drops to 0", async () => {
        vi.useFakeTimers();
        boot({ "workbench.sash.hoverDelay": 1000 });
        const cell = sidebarSashCell();
        hoverAt(cell);
        await configuration.updateValue("workbench.sash.hoverDelay", 0);
        h.testApp.render();
        expect(isLit(cell)).toBe(false);
        vi.advanceTimersByTime(1000);
        h.testApp.render();
        expect(isLit(cell)).toBe(true);
    });

    it("a show already pending keeps its delay when the setting grows", async () => {
        vi.useFakeTimers();
        boot({ "workbench.sash.hoverDelay": 300 });
        const cell = sidebarSashCell();
        hoverAt(cell);
        await configuration.updateValue("workbench.sash.hoverDelay", 2000);
        vi.advanceTimersByTime(300);
        h.testApp.render();
        expect(isLit(cell)).toBe(true);
    });

    it("the panel and secondary side bar sashes wait the delay too", async () => {
        vi.useFakeTimers();
        boot({ "workbench.sash.hoverDelay": 300 });
        await h.commands.execute("workbench.action.togglePanel");
        await h.commands.execute("workbench.action.toggleAuxiliaryBar");
        h.testApp.render();
        const sashes = findSashes(h.testApp.root).filter((s) => !s.hidden);
        expect(sashes.length).toBe(3);
        const color = h.container.get(ThemeServiceDIToken).theme.getRequiredColor("sash.hoverBorder");
        for (const s of sashes) {
            const c = new Point(
                s.globalPosition.x + Math.floor(s.layoutSize.width / 2),
                s.globalPosition.y + Math.floor(s.layoutSize.height / 2),
            );
            hoverAt(new Point(0, 0));
            hoverAt(c);
            expect(h.testApp.backend.getFgAt(c)).not.toBe(color);
            vi.advanceTimersByTime(300);
            h.testApp.render();
            expect(h.testApp.backend.getFgAt(c)).toBe(color);
        }
    });
});
