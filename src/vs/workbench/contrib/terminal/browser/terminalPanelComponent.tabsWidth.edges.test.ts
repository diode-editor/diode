import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildHarness, WIDTH } from "./terminalPanelComponent.tabs.testUtils.ts";

const HORIZONTAL = "terminal.tabs-list-width-horizontal";
const ROW = 5;

function harness(stored: Readonly<Record<string, unknown>> = {}, shells: readonly string[] = []) {
    const h = buildHarness({}, shells, undefined, stored);
    h.service.newTerminal();
    h.service.newTerminal();
    h.screen();
    const view = h.component.view;
    const list = h.component.tabs.list;
    const divider = (): number => {
        h.screen();
        return list.globalPosition.x === view.globalPosition.x
            ? list.globalPosition.x + list.layoutSize.width
            : list.globalPosition.x - 1;
    };
    const doubleClick = (): void => {
        const x = divider();
        for (let i = 0; i < 2; i++) {
            h.mouse("left", x, ROW, "press");
            h.mouse("left", x, ROW, "release");
        }
        h.screen();
    };
    return { ...h, view, list, divider, doubleClick };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("TerminalPanelComponent — tabs list width, edges", () => {
    it("double-click counts a wide-character name in cells, so the name isn't cut", () => {
        const h = harness();
        const name = "日本語のシェル";
        h.service.createInstance({ name });
        h.screen();
        h.doubleClick();
        // " <icon> " + 7 wide characters (14 cells) + 1 column of padding.
        expect(h.list.layoutSize.width).toBe(1 + 1 + 1 + 14 + 1);
        expect(h.lines().some((line) => line.includes(name))).toBe(true);
        h.dispose();
    });

    it("double-click ignores a long-named terminal that has been closed", () => {
        const h = harness();
        const long = h.service.createInstance({ name: "a-terminal-with-a-very-long-name" });
        h.screen();
        h.service.closeInstance(long.id);
        h.screen();
        expect(h.component.tabsVisible).toBe(true);
        h.doubleClick();
        expect(h.list.layoutSize.width).toBe(10);
        h.dispose();
    });

    it("double-click ignores a long-named terminal moved to the editor area", () => {
        const h = harness();
        const long = h.service.createInstance({ name: "a-terminal-with-a-very-long-name" });
        h.screen();
        h.service.moveToEditor(long.id);
        h.screen();
        h.doubleClick();
        expect(h.list.layoutSize.width).toBe(10);
        h.dispose();
    });

    it("the highlight holds during the whole drag, even with the pointer off the sash", () => {
        const h = harness();
        vi.useFakeTimers();
        const from = h.divider();
        h.mouse("left", from, ROW, "press");
        h.testApp.render();
        h.mouse("left", from - 8, ROW, "move");
        h.testApp.render();
        vi.advanceTimersByTime(1000);
        h.testApp.render();
        const sash = h.divider();
        expect(sash).toBe(from - 8);
        expect(h.testApp.backend.getFgAt(new Point(sash, ROW))).toBe(h.view.styleVar("sash.hoverBorder"));
        h.mouse("left", sash, ROW, "release");
        h.dispose();
    });

    it("after a drag a click on a tab still activates it", () => {
        const h = harness();
        const from = h.divider();
        h.mouse("left", from, ROW, "press");
        h.testApp.render();
        h.mouse("left", from - 5, ROW, "move");
        h.testApp.render();
        h.mouse("left", from - 5, ROW, "release");
        h.screen();
        h.clickRow(0);
        expect(h.activeIndex()).toBe(0);
        h.clickRow(1);
        expect(h.activeIndex()).toBe(1);
        h.dispose();
    });

    it("dragging on a narrow panel keeps the list at no more than half", () => {
        const h = harness();
        h.testApp.backend.resize(new Size(24, 12));
        h.screen();
        const from = h.divider();
        h.mouse("left", from, ROW, "press");
        h.testApp.render();
        h.mouse("left", 0, ROW, "move");
        h.testApp.render();
        h.mouse("left", 0, ROW, "release");
        h.screen();
        expect(h.list.layoutSize.width).toBe(Math.floor(h.view.layoutSize.width / 2));
        expect(WIDTH).toBe(80);
        h.dispose();
    });
    it("a mouse drag that starts in the terminal and crosses the divider doesn't resize the list", () => {
        const h = harness();
        const from = h.divider();
        h.mouse("left", 5, ROW, "press");
        h.testApp.render();
        h.mouse("left", from, ROW, "move");
        h.testApp.render();
        h.mouse("left", from + 6, ROW, "move");
        h.testApp.render();
        h.mouse("left", from + 6, ROW, "release");
        h.screen();
        expect(h.list.layoutSize.width).toBe(20);
        expect(h.views.stored.has(HORIZONTAL)).toBe(false);
        h.dispose();
    });

    it("a drag released over a tab doesn't activate that tab", () => {
        const h = harness();
        h.clickRow(1);
        const target = h.rowOf(0).globalPosition;
        const from = h.divider();
        h.mouse("left", from, target.y, "press");
        h.testApp.render();
        h.mouse("left", from + 4, target.y, "move");
        h.testApp.render();
        h.mouse("left", from + 4, target.y, "release");
        h.screen();
        expect(h.list.layoutSize.width).toBe(16);
        expect(h.activeIndex()).toBe(1);
        h.dispose();
    });
});
