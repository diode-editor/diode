import { Point } from "@tuidom/core/common/geometryPromitives";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildHarness, WIDTH } from "./terminalPanelComponent.tabs.testUtils.ts";
import { TERMINAL_VIEW_ID } from "./terminalService.ts";
import { TERMINAL_TABS_WIDTH } from "./terminalTabsList.ts";

const HORIZONTAL = "terminal.tabs-list-width-horizontal";
const VERTICAL = "terminal.tabs-list-width-vertical";
const ROW = 5;

/** Two terminals in the panel, so the list on the right is shown. */
function twoTerminals(stored: Readonly<Record<string, unknown>> = {}, shells: readonly string[] = []) {
    const h = buildHarness({}, shells, undefined, stored);
    h.service.newTerminal();
    h.service.newTerminal();
    h.screen();
    const view = h.component.view;
    const list = h.component.tabs.list;
    /** Column of the divider (the sash) in the frame. */
    const divider = (): number => view.globalPosition.x + view.layoutSize.width - list.layoutSize.width - 1;
    const drag = (from: number, to: number): void => {
        h.mouse("left", from, ROW, "press");
        h.testApp.render();
        h.mouse("left", to, ROW, "move");
        h.testApp.render();
        h.mouse("left", to, ROW, "release");
        h.screen();
    };
    const doubleClick = (x: number): void => {
        for (let i = 0; i < 2; i++) {
            h.mouse("left", x, ROW, "press");
            h.mouse("left", x, ROW, "release");
        }
        h.screen();
    };
    return { ...h, view, list, divider, drag, doubleClick };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("TerminalPanelComponent — tabs list width", () => {
    it("starts at 20 columns without a saved width", () => {
        const h = twoTerminals();
        expect(h.list.layoutSize.width).toBe(TERMINAL_TABS_WIDTH);
        expect(h.divider()).toBe(WIDTH - TERMINAL_TABS_WIDTH - 1);
        expect(h.lines()[ROW][h.divider()]).toBe("│");
        h.dispose();
    });

    it("dragging the divider resizes the list and saves the width under the horizontal key", () => {
        const h = twoTerminals();
        const store = vi.spyOn(h.views.state, "store");
        h.drag(h.divider(), h.divider() - 10);
        expect(h.list.layoutSize.width).toBe(30);
        expect(h.lines()[ROW][WIDTH - 31]).toBe("│");
        expect(h.views.stored.get(HORIZONTAL)).toBe(30);
        expect(h.views.stored.has(VERTICAL)).toBe(false);
        expect(store.mock.calls.every(([descriptor]) => descriptor.scope === "global")).toBe(true);
        h.dispose();
    });

    it("restores the saved width", () => {
        const h = twoTerminals({ [HORIZONTAL]: 33, [VERTICAL]: 12 });
        expect(h.list.layoutSize.width).toBe(33);
        h.dispose();
    });

    it.each([["wide"], [0], [-4], [12.5], [null], [{}]])("a saved %j is ignored: 20", (value) => {
        const h = twoTerminals({ [HORIZONTAL]: value });
        expect(h.list.layoutSize.width).toBe(TERMINAL_TABS_WIDTH);
        h.dispose();
    });

    it("keeps what the user set; only the layout clamps it", () => {
        const h = twoTerminals({ [HORIZONTAL]: 500 });
        expect(h.list.layoutSize.width).toBe(62);
        expect(h.views.stored.get(HORIZONTAL)).toBe(500);
        h.dispose();
    });

    it("the width survives hiding and showing the list", () => {
        const h = twoTerminals();
        h.drag(h.divider(), h.divider() - 6);
        h.service.closeInstance(h.service.getInstances()[1].id);
        h.screen();
        expect(h.component.tabsVisible).toBe(false);
        h.service.newTerminal();
        h.screen();
        expect(h.list.layoutSize.width).toBe(26);
        h.dispose();
    });

    it("tabs.location moves the list with its width and the sash with the divider", async () => {
        const h = twoTerminals({ [HORIZONTAL]: 30 });
        await h.configuration.updateValue("terminal.integrated.tabs.location", "left");
        h.screen();
        expect(h.list.globalPosition.x).toBe(h.view.globalPosition.x);
        expect(h.list.layoutSize.width).toBe(30);
        const divider = h.view.globalPosition.x + 30;
        expect(h.lines()[ROW][divider]).toBe("│");
        // On the left, dragging right widens the list.
        h.drag(divider, divider + 4);
        expect(h.list.layoutSize.width).toBe(34);
        expect(h.views.stored.get(HORIZONTAL)).toBe(34);
        h.dispose();
    });

    it("in a side bar the width lives under the vertical key; back in the panel — the horizontal one", () => {
        const h = twoTerminals({ [VERTICAL]: 14 });
        h.views.service.moveViewToLocation(TERMINAL_VIEW_ID, "auxiliarybar");
        expect(h.view.tabsColumns).toBe(14);
        h.views.service.moveViewToLocation(TERMINAL_VIEW_ID, "sidebar");
        expect(h.view.tabsColumns).toBe(14);
        h.views.service.moveViewToLocation(TERMINAL_VIEW_ID, "panel");
        h.screen();
        expect(h.list.layoutSize.width).toBe(TERMINAL_TABS_WIDTH);
        h.dispose();
    });

    it("double-click on the divider fits the list to the longest tab and saves it; again — nothing", () => {
        const long = "a-shell-with-a-long-name";
        const h = twoTerminals({}, ["/bin/bash", `/bin/${long}`]);
        const store = vi.spyOn(h.views.state, "store");
        h.doubleClick(h.divider());
        // " <icon> <title>" plus a column of padding.
        const fitted = 1 + 1 + 1 + long.length + 1;
        expect(h.list.layoutSize.width).toBe(fitted);
        expect(h.views.stored.get(HORIZONTAL)).toBe(fitted);
        expect(h.lines().some((line) => line.endsWith(`${long} `))).toBe(true);
        expect(store).toHaveBeenCalledTimes(1);

        h.doubleClick(h.divider());
        expect(h.list.layoutSize.width).toBe(fitted);
        expect(store).toHaveBeenCalledTimes(1);
        h.dispose();
    });

    it("double-click with short names narrows the list down to 10", () => {
        const h = twoTerminals();
        h.doubleClick(h.divider());
        expect(h.list.layoutSize.width).toBe(10);
        expect(h.views.stored.get(HORIZONTAL)).toBe(10);
        h.dispose();
    });

    it("workbench.sash.hoverDelay applies to the divider, live", async () => {
        const h = twoTerminals();
        vi.useFakeTimers();
        const cell = (): Point => new Point(h.divider(), ROW);
        const fg = (): number => h.testApp.backend.getFgAt(cell());
        const rest = fg();
        const hover = (x: number): void => {
            h.mouse("none", x, ROW, "move");
            h.testApp.render();
        };
        await h.configuration.updateValue("workbench.sash.hoverDelay", 0);
        hover(h.divider());
        expect(fg()).toBe(h.view.styleVar("sash.hoverBorder"));
        hover(2);
        expect(fg()).toBe(rest);

        await h.configuration.updateValue("workbench.sash.hoverDelay", 1000);
        hover(h.divider());
        expect(fg()).toBe(rest);
        h.dispose();
    });
});
