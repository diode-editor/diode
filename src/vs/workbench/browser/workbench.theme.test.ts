import { describe, expect, it } from "vitest";

import type { HFlexElement } from "@tuidom/elements/layout/hFlexElement";
import { createAppTestHarness } from "../../../TestUtils/AppTestHarness.ts";
import type { TestApp } from "../../../TestUtils/TestApp.ts";
import { WorkbenchTheme } from "../../platform/theme/common/workbenchTheme.ts";
import { ThemeServiceDIToken } from "../services/themes/common/themeTokens.ts";

import { statusTexts } from "./parts/statusbar/statusBarComponent.testUtils.ts";

describe("Workbench — theme application", () => {
    it("applies foreground/background colors the theme defines", () => {
        const h = createAppTestHarness();
        const themeService = h.container.get(ThemeServiceDIToken);

        const theme = WorkbenchTheme.fromThemeFile({
            name: "colored",
            type: "dark",
            colors: { foreground: "#AABBCC", "editor.background": "#102030" },
        });
        themeService.setTheme(theme);
        h.testApp.render();

        // Стиль корня — токены; резолвит каскад из палитры, пушенной setTheme.
        expect(h.workbench.view.resolvedStyle.fg).toBe(0xaabbcc);
        expect(h.workbench.view.resolvedStyle.bg).toBe(0x102030);
    });

    it("falls back to the default color registry when the theme omits foreground/background", () => {
        const h = createAppTestHarness();
        const themeService = h.container.get(ThemeServiceDIToken);

        // A theme with neither "foreground" nor "editor.background": the dark
        // default registry supplies both, so the workbench is never left uncolored.
        const sparseTheme = WorkbenchTheme.fromThemeFile({ name: "sparse", type: "dark", colors: {} });
        themeService.setTheme(sparseTheme);
        h.testApp.render();

        expect(h.workbench.view.resolvedStyle.fg).toBe(0xcccccc); // default dark "foreground"
        expect(h.workbench.view.resolvedStyle.bg).toBe(0x1e1e1e); // default dark "editor.background"
    });
});

describe("Workbench — chord with standalone modifier key", () => {
    function chordHints(testApp: TestApp): string[] {
        return statusTexts(testApp.querySelector("#statusBar") as HFlexElement);
    }

    it("a standalone modifier keydown while a chord is pending is not swallowed by the chord-capture layer", () => {
        const h = createAppTestHarness();
        h.workbench.openFile("/tmp/chord-modifier.txt");
        h.workbench.focusEditor();

        h.testApp.sendKey("Ctrl+K");
        expect(chordHints(h.testApp).some((t) => t.includes("Waiting"))).toBe(true);

        // Kitty protocol delivers a standalone Shift keydown while the chord waits.
        // The capture handler special-cases modifier keys (it returns early instead of
        // intercepting/swallowing them), so the event is allowed to propagate normally.
        h.testApp.backend.sendRaw("\x1b[57441;1:1u"); // Shift down

        // The waiting hint is gone — the modifier reached the bubble dispatcher rather
        // than being consumed silently by the chord-capture interceptor.
        expect(chordHints(h.testApp).some((t) => t.includes("Waiting"))).toBe(false);
    });
});
