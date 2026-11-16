import { Point } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

import { createStatusBarHarness } from "./statusBarComponent.testUtils.ts";

describe("StatusBarComponent — the service's style override", () => {
    const vars = computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme));

    it("the bar takes the override's colors and gets its own back when the override goes", () => {
        const { component, statusBarService } = createStatusBarHarness();
        const at = new Point(2, 0);

        const override = statusBarService.overrideStyle({
            priority: 10,
            foreground: "editorError.foreground",
            background: "editorWarning.foreground",
        });
        let backend = renderElement(component.view, 40, 1, { themeVars: true });
        expect(backend.getFgAt(at)).toBe(vars["editorError.foreground"]);
        expect(backend.getBgAt(at)).toBe(vars["editorWarning.foreground"]);

        override.dispose();
        backend = renderElement(component.view, 40, 1, { themeVars: true });
        expect(backend.getFgAt(at)).toBe(vars["statusBar.foreground"]);
        expect(backend.getBgAt(at)).toBe(vars["statusBar.background"]);
    });
});
