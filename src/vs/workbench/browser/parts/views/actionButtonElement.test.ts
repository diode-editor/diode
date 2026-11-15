import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

import { ActionButtonElement } from "./actionButtonElement.ts";

const vars = computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme));

function button(label: string): { element: ActionButtonElement; activations: () => number } {
    const element = new ActionButtonElement();
    element.setLabel(label);
    let count = 0;
    element.onActivate = () => {
        count++;
    };
    return { element, activations: () => count };
}

describe("ActionButtonElement", () => {
    it("fills the whole width with the button background and centers the label", () => {
        const { element } = button("Run and Debug");
        const backend = renderElement(element, 21, 1, { themeVars: true });

        expect(backend.getTextAt(new Point(0, 0), 21)).toBe("    Run and Debug    ");
        expect(backend.getBgAt(new Point(0, 0))).toBe(vars["button.background"]);
        expect(backend.getBgAt(new Point(20, 0))).toBe(vars["button.background"]);
        expect(backend.getFgAt(new Point(4, 0))).toBe(vars["button.foreground"]);
        expect(element.getMinIntrinsicHeight(21)).toBe(1);
        expect(element.getMaxIntrinsicHeight(21)).toBe(1);
    });

    it("a label wider than the button starts at the left edge and is cut", () => {
        const { element } = button("Run and Debug");
        const backend = renderElement(element, 7, 1, { themeVars: true });

        expect(backend.getTextAt(new Point(0, 0), 7)).toBe("Run and");
    });

    it("disabled: the secondary colors, no focus, no activation", () => {
        const { element, activations } = button("Commit");
        element.setDisabled(true);
        const backend = renderElement(element, 10, 1, { themeVars: true });

        expect(element.isDisabled()).toBe(true);
        expect(element.focusable).toBe(false);
        expect(backend.getBgAt(new Point(0, 0))).toBe(vars["button.secondaryBackground"]);
        expect(backend.getFgAt(new Point(2, 0))).toBe(vars["button.secondaryForeground"]);
        backend.sendKey("Enter");
        expect(activations()).toBe(0);
        expect(element.inspectState()).toEqual({ label: "Commit", disabled: true, hidden: false });
    });

    it("Enter, Space and a click activate it; other keys do not", () => {
        const { element, activations } = button("Run and Debug");
        const app = TestApp.createWithContent(element, new Size(20, 1));
        element.focus();

        app.sendKey("Enter");
        app.sendKey(" ");
        app.sendKey("a");
        expect(activations()).toBe(2);

        for (const action of ["press", "release"] as const) {
            app.backend.simulateMouse({
                kind: "mouse",
                button: "left",
                x: 3,
                y: 1,
                action,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            });
        }
        expect(activations()).toBe(3);
        expect(element.getLabel()).toBe("Run and Debug");
    });
});
