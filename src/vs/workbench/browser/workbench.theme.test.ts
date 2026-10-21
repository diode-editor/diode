import type { HFlexElement } from "@tuidom/elements/layout/hFlexElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
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

        expect(h.workbench.view.resolvedStyle.fg).toBe(0xaabbcc);
        expect(h.workbench.view.resolvedStyle.bg).toBe(0x102030);
    });

    it("falls back to the default color registry when the theme omits foreground/background", () => {
        const h = createAppTestHarness();
        const themeService = h.container.get(ThemeServiceDIToken);

        const sparseTheme = WorkbenchTheme.fromThemeFile({ name: "sparse", type: "dark", colors: {} });
        themeService.setTheme(sparseTheme);
        h.testApp.render();

        expect(h.workbench.view.resolvedStyle.fg).toBe(0xcccccc); // default dark "foreground"
        expect(h.workbench.view.resolvedStyle.bg).toBe(0x1e1e1e); // default dark "editor.background"
    });
});

/**
 * Regression: the SCM header (ViewContainerHeaderElement) took tuidom's
 * `titledPanel.titleForeground` (#828282) and rendered dimmer than Explorer/Search.
 */
describe("Workbench — цвет заголовков вьюлетов", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ files: { "alpha.txt": "Alpha" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    /** Shows the viewlet (the sidebar hosts only the active one) and reads the header fg. */
    function headerFg(viewletCommand: string, selector: string): number | undefined {
        void h.commands.execute(viewletCommand);
        h.testApp.render();
        const header = h.testApp.querySelector(selector);
        expect(header, `no header for "${selector}"`).not.toBeNull();
        return header!.resolvedStyle.fg;
    }

    it("Explorer, Search и Source Control красят заголовок одним цветом", () => {
        // Explorer and Search are merged, so PaneHeaderElement carries the header;
        // SCM (CHANGES + GRAPH) has a separate container header.
        const explorer = headerFg("workbench.view.explorer", "#paneHeader-workbench-explorer-fileView");
        const search = headerFg("workbench.view.search", "#paneHeader-workbench-search-results");
        const scm = headerFg("workbench.view.scm", "#viewContainerHeader-scm");

        expect(explorer).toBe(scm);
        expect(search).toBe(scm);
        // Dark+ sets sideBarTitle.foreground explicitly — not tuidom's default (#828282).
        expect(scm).toBe(0xbbbbbb);
    });

    it("заголовки секций SCM берут sideBarSectionHeader.foreground", () => {
        // Dark+ does not set this token — the value comes from the registry defaults.
        expect(headerFg("workbench.view.scm", "#paneHeader-workbench-scm-changes")).toBe(0xcccccc);
    });

    it("тема без заголовочных токенов не роняет заголовки на дефолт tuidom", () => {
        // Monokai sets neither sideBarTitle.foreground nor the section token: without
        // registry defaults they would stay at the engine's #828282.
        const themeService = h.container.get(ThemeServiceDIToken);
        themeService.setTheme(WorkbenchTheme.fromThemeFile({ name: "bare", type: "dark", colors: {} }));

        expect(headerFg("workbench.view.scm", "#viewContainerHeader-scm")).toBe(0xcccccc);
        expect(headerFg("workbench.view.scm", "#paneHeader-workbench-scm-changes")).toBe(0xcccccc);
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

        // The capture handler returns early on modifier keys instead of swallowing them.
        h.testApp.backend.sendRaw("\x1b[57441;1:1u"); // Shift down

        expect(chordHints(h.testApp).some((t) => t.includes("Waiting"))).toBe(false);
    });
});
