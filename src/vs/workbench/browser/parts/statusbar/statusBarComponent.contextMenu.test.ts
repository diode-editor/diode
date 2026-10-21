import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import type { HFlexLayoutStyle } from "@tuidom/elements/layout/hFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { CHECKED_ICON } from "../../../../platform/actions/common/menuRegistry.ts";
import type { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";

import { createStatusBarHarness, statusTexts } from "./statusBarComponent.testUtils.ts";

const SCREEN = new Size(60, 10);
const BAR_Y = SCREEN.height - 1;

function rightClick(x: number, y: number, action: "press" | "release"): MouseToken {
    return {
        kind: "mouse",
        button: "right",
        x: x + 1,
        y: y + 1,
        action,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

interface MenuHarness {
    app: TestApp;
    statusBarService: StatusBarService;
    /** null clicks an empty spot of the bar. */
    openMenuOn: (text: string | null) => void;
    /** A right click must not trigger these. */
    clicks: string[];
    segments: () => string[];
}

function menuState(app: TestApp): { items: (string | null)[]; selectedIndex: number } {
    const menu = app.querySelector("PopupMenuElement");
    const state = menu?.inspectState();
    if (state === undefined) throw new Error("context menu is not open");
    return { items: state.items as (string | null)[], selectedIndex: state.selectedIndex as number };
}

/** Separators are null. */
function menuItems(app: TestApp): (string | null)[] {
    return menuState(app).items;
}

function activateMenuItem(app: TestApp, label: string): void {
    const target = menuItems(app).indexOf(label);
    if (target < 0) throw new Error(`menu has no item "${label}"`);
    while (menuState(app).selectedIndex !== target) {
        app.sendKey("ArrowDown");
    }
    app.sendKey("Enter");
    app.render();
}

function setup(): MenuHarness {
    const harness = createStatusBarHarness();
    const clicks: string[] = [];
    harness.statusBarService.addEntry({
        id: "alpha",
        name: "Alpha",
        text: "Alpha",
        alignment: "left",
        priority: 10,
        onClick: () => clicks.push("alpha"),
    });
    harness.statusBarService.addEntry({ id: "beta", name: "Beta", text: "Beta", alignment: "left", priority: 5 });
    harness.statusBarService.addEntry({ id: "hint", text: "chord", alignment: "left", priority: 1 });
    harness.statusBarService.addEntry({ id: "omega", name: "Omega", text: "Omega", alignment: "right", priority: 1 });

    const body = new BodyElement();
    body.setStatusBar(harness.component.view);
    const app = TestApp.create(body, SCREEN);
    app.render();

    const openMenuOn = (text: string | null): void => {
        const children = harness.component.view.getChildren();
        let x: number;
        if (text === null) {
            // The center spacer Filler between the two sides.
            const fill = children.find((child) => (child.layoutStyle as HFlexLayoutStyle).width.type === "fill");
            if (!fill) throw new Error("the bar has no center spacer");
            x = fill.globalPosition.x + Math.floor(fill.layoutSize.width / 2);
        } else {
            const label = children.find(
                (child): child is TextLabelElement =>
                    child instanceof TextLabelElement && child.getText() === ` ${text} `,
            );
            if (!label) throw new Error(`status bar has no segment "${text}"`);
            x = label.globalPosition.x + 1;
        }
        app.backend.simulateMouse(rightClick(x, BAR_Y, "press"));
        app.backend.simulateMouse(rightClick(x, BAR_Y, "release"));
        app.render();
    };

    return {
        app,
        statusBarService: harness.statusBarService,
        openMenuOn,
        clicks,
        segments: () => statusTexts(harness.component.view),
    };
}

describe("StatusBarComponent — visibility menu", () => {
    it("right click on the bar opens the toggle for named entries", () => {
        const { app, openMenuOn } = setup();

        openMenuOn("Alpha");

        // Right segments come after left ones, matching render order.
        expect(menuItems(app)).toEqual(["Terminal Environment", "Alpha", "Beta", "Omega", null, "Hide 'Alpha'"]);
        expect(app.backend.screenToString()).toContain(`${CHECKED_ICON} Alpha`);
    });

    it("right click on a clickable segment does not run its command", () => {
        const { openMenuOn, clicks } = setup();

        openMenuOn("Alpha");

        expect(clicks).toEqual([]);
    });

    it("the menu has Hide 'X' for the segment under the mouse", () => {
        const { app, openMenuOn } = setup();

        openMenuOn("Beta");

        expect(app.backend.screenToString()).toContain("Hide 'Beta'");
    });

    it("right click off the segments gives a menu without 'Hide'", () => {
        const { app, openMenuOn } = setup();

        openMenuOn(null);

        expect(menuItems(app)).toEqual(["Terminal Environment", "Alpha", "Beta", "Omega"]);
    });

    it("right click on a transient segment without a name gives no 'Hide' either", () => {
        const { app, openMenuOn } = setup();

        openMenuOn("chord");

        expect(menuItems(app)).toEqual(["Terminal Environment", "Alpha", "Beta", "Omega"]);
    });

    it("Hide 'X' works for right segments too", () => {
        const { app, openMenuOn, segments } = setup();

        openMenuOn("Omega");
        expect(menuItems(app)).toContain("Hide 'Omega'");

        activateMenuItem(app, "Hide 'Omega'");
        expect(segments()).not.toContain("Omega");
    });

    it("the menu opens upward — the bar is the bottom screen row", () => {
        const { app, openMenuOn } = setup();

        openMenuOn("Alpha");

        const menu = app.querySelector("PopupMenuElement");
        expect(menu).not.toBeNull();
        expect(menu!.globalPosition.y + menu!.layoutSize.height).toBeLessThanOrEqual(BAR_Y);
    });

    it("unchecking removes the segment from the bar", () => {
        const { app, openMenuOn, segments, statusBarService } = setup();
        expect(segments()).toContain("Alpha");

        openMenuOn("Alpha");
        activateMenuItem(app, "Alpha");

        expect(statusBarService.isHidden("alpha")).toBe(true);
        expect(segments()).not.toContain("Alpha");
        expect(app.querySelector("PopupMenuElement")).toBeNull();
    });

    it("Hide 'X' hides the segment under the mouse", () => {
        const { app, openMenuOn, segments } = setup();

        openMenuOn("Beta");
        activateMenuItem(app, "Hide 'Beta'");

        expect(segments()).not.toContain("Beta");
    });

    it("a hidden entry stays in the menu unchecked — it can be restored", () => {
        const { app, openMenuOn, segments, statusBarService } = setup();
        statusBarService.setHidden("alpha", true);
        app.render();
        expect(segments()).not.toContain("Alpha");

        openMenuOn(null);
        expect(menuItems(app)).toContain("Alpha");
        expect(app.backend.screenToString()).not.toContain(`${CHECKED_ICON} Alpha`);

        activateMenuItem(app, "Alpha");
        expect(segments()).toContain("Alpha");
    });
});
