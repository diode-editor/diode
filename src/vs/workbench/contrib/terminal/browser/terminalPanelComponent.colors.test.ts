import { NO_HOST_COLORS } from "@tuidom/core/backend/iTerminalBackend";
import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it, vi } from "vitest";

import { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { PanelComponent } from "../../../browser/parts/panel/panelComponent.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { lightPlusTheme } from "../../../services/themes/common/themes/lightPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { makeTerminalColors } from "./terminalColorsService.testUtils.ts";
import { TerminalPanelComponent } from "./terminalPanelComponent.ts";
import { TERMINAL_VIEW_ID, TerminalService } from "./terminalService.ts";

const DARK = WorkbenchTheme.fromThemeFile(darkPlusTheme);
const LIGHT = WorkbenchTheme.fromThemeFile(lightPlusTheme);
const HOST_BG = packRgb(1, 2, 3);
const HOST_FG = packRgb(250, 240, 230);
const HOST_RED = packRgb(200, 10, 10);

function buildHarness(settings: Readonly<Record<string, unknown>> = {}) {
    const themeService = new ThemeService(DARK);
    const views = makeViewsHarness();
    const panelComponent = new PanelComponent(views.panelService, new CommandRegistry());
    const configuration = createTestConfigurationService(settings);
    const sessions: FakeTerminalSurface[] = [];
    const service = new TerminalService(views.panelService, views.service, configuration, () => {
        const surface = new FakeTerminalSurface();
        surface.setGrid(["$ "]);
        sessions.push(surface);
        return surface;
    });
    views.service.attachRegisteredContainers();
    const { colors } = makeTerminalColors(themeService, configuration, {
        foreground: HOST_FG,
        background: HOST_BG,
        ansi: NO_HOST_COLORS.ansi.map((_, index) => (index === 1 ? HOST_RED : undefined)),
    });
    const component = new TerminalPanelComponent(
        service,
        views.service,
        { focusEditor: vi.fn() },
        configuration,
        {} as ContextMenuService,
        new CommandRegistry(),
        colors,
    );
    const testApp = TestApp.createWithContent(panelComponent.view, new Size(70, 12));
    const widget = (): TUIElement => views.paneView(TERMINAL_VIEW_ID).querySelectorAll("TerminalViewElement")[0];
    /** Цвета ячейки (1, 0) терминала — пустая, без своих цветов: видны дефолтные фон/текст. */
    const defaultCell = (): { fg: number; bg: number } => {
        testApp.render();
        const pos = widget().globalPosition;
        const point = new Point(pos.x + 1, pos.y);
        return { fg: testApp.backend.getFgAt(point), bg: testApp.backend.getBgAt(point) };
    };
    const dispose = (): void => {
        component.dispose();
        service.dispose();
        colors.dispose();
    };
    return { themeService, configuration, service, sessions, widget, defaultCell, dispose };
}

describe("TerminalPanelComponent — цвета терминала (terminal.integrated.colorSource)", () => {
    it("по умолчанию — тема: сессия получает terminal.ansi* темы, фон/текст — токены темы", () => {
        const h = buildHarness();
        h.service.openTerminal();
        expect(h.sessions[0].ansiColors?.[1]).toBe(DARK.getRequiredColor("terminal.ansiRed"));
        expect(h.defaultCell()).toEqual({
            fg: h.widget().styleVar("terminal.foreground"),
            bg: h.widget().styleVar("terminal.background"),
        });
        expect(h.defaultCell().bg).not.toBe(HOST_BG);
        h.dispose();
    });

    it("смена темы перекрашивает палитру открытых терминалов", () => {
        const h = buildHarness();
        h.service.openTerminal();
        h.service.newTerminal();
        h.themeService.setTheme(LIGHT);
        for (const session of h.sessions)
            expect(session.ansiColors?.[2]).toBe(LIGHT.getRequiredColor("terminal.ansiGreen"));
        h.dispose();
    });

    it("host: палитра и дефолтные фон/текст — от хост-терминала, неотвеченное — из темы", () => {
        const h = buildHarness({ "terminal.integrated.colorSource": "host" });
        h.service.openTerminal();
        expect(h.sessions[0].ansiColors?.[1]).toBe(HOST_RED);
        expect(h.sessions[0].ansiColors?.[2]).toBe(DARK.getRequiredColor("terminal.ansiGreen"));
        expect(h.defaultCell()).toEqual({ fg: HOST_FG, bg: HOST_BG });
        h.dispose();
    });

    it("переключение настройки на лету: host красит открытый терминал, theme возвращает токены темы", async () => {
        const h = buildHarness();
        h.service.openTerminal();
        const themeCell = h.defaultCell();

        await h.configuration.updateValue("terminal.integrated.colorSource", "host");
        expect(h.defaultCell()).toEqual({ fg: HOST_FG, bg: HOST_BG });
        expect(h.sessions[0].ansiColors?.[1]).toBe(HOST_RED);

        await h.configuration.updateValue("terminal.integrated.colorSource", "theme");
        expect(h.defaultCell()).toEqual(themeCell);
        expect(h.sessions[0].ansiColors?.[1]).toBe(DARK.getRequiredColor("terminal.ansiRed"));
        h.dispose();
    });
});
