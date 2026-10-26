import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";

import { WorkbenchLayoutElement } from "./workbenchLayoutElement.ts";

/** Sidebar 20 columns, right panel 20 (a quarter of 80), bottom panel 6 rows — in 80×24. */
function startApp(): TestApp {
    const layout = new WorkbenchLayoutElement();
    layout.setLeftPanel(new TUIElement());
    layout.setCenterContent(new TUIElement());
    layout.setLeftPanelWidth(20);
    layout.setRightPanel(new TUIElement());
    layout.setRightPanelVisible(true);
    layout.setBottomPanel(new TUIElement());
    layout.setBottomPanelVisible(true);
    layout.setBottomPanelHeight(6);
    return TestApp.createWithContent(layout, new Size(80, 24));
}

/** Mouse at a screen column/row (0-based; the mouse token is 1-based). */
function mouse(app: TestApp, action: MouseToken["action"], button: MouseToken["button"], x: number, y: number): void {
    app.backend.simulateMouse({
        kind: "mouse",
        button,
        action,
        x: x + 1,
        y: y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    });
}

describe("WorkbenchLayoutElement: mouse pointer over the sashes", () => {
    it.each([
        { sash: "sidebar", x: 20, y: 5, shape: "ew-resize" },
        { sash: "right panel", x: 60, y: 5, shape: "ew-resize" },
        { sash: "bottom panel", x: 40, y: 18, shape: "ns-resize" },
    ])("hovering the $sash sash gives $shape, the editor next to it — default", ({ x, y, shape }) => {
        const app = startApp();

        mouse(app, "move", "none", x, y);
        expect(app.backend.pointerShape).toBe(shape);

        mouse(app, "move", "none", 40, 8);
        expect(app.backend.pointerShape).toBe("default");
    });

    it("the arrow stays for the whole sidebar drag and goes on release off the sash", () => {
        const app = startApp();

        mouse(app, "move", "none", 20, 5);
        mouse(app, "press", "left", 20, 5);
        mouse(app, "move", "left", 35, 12);
        expect(app.backend.pointerShape).toBe("ew-resize");

        // The sash followed the pointer to column 35; the button comes up off it.
        mouse(app, "release", "left", 50, 12);
        expect(app.backend.pointerShape).toBe("default");
    });
});
