import { NO_HOST_COLORS } from "@tuidom/core/backend/iTerminalBackend";
import { packRgb } from "@tuidom/core/common/colorUtils";
import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { describe, expect, it, vi } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { lightPlusTheme } from "../../../services/themes/common/themes/lightPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { resolveTerminalColors, TerminalColorsService } from "./terminalColorsService.ts";

const DARK = WorkbenchTheme.fromThemeFile(darkPlusTheme);
const LIGHT = WorkbenchTheme.fromThemeFile(lightPlusTheme);

/** Дефолты эталона (`ansiColorMap`) для тёмной темы, индексы 0..15. */
const VSCODE_DARK_ANSI = [
    "#000000",
    "#cd3131",
    "#0dbc79",
    "#e5e510",
    "#2472c8",
    "#bc3fbc",
    "#11a8cd",
    "#e5e5e5",
    "#666666",
    "#f14c4c",
    "#23d18b",
    "#f5f543",
    "#3b8eea",
    "#d670d6",
    "#29b8db",
    "#e5e5e5",
].map((hex) => Number.parseInt(hex.slice(1), 16));

/** Хост ответил частично: фон, красный и ярко-белый. */
const PARTIAL_HOST = {
    foreground: undefined,
    background: packRgb(1, 2, 3),
    ansi: NO_HOST_COLORS.ansi.map((_, index) =>
        index === 1 ? packRgb(200, 0, 0) : index === 15 ? packRgb(250, 250, 250) : undefined,
    ),
};

function build(settings: Record<string, unknown> = {}, hostColors = NO_HOST_COLORS) {
    const themeService = new ThemeService(DARK);
    const configuration = createTestConfigurationService(settings);
    const backend = new MockTerminalBackend();
    backend.hostColors = hostColors;
    const probe = vi.spyOn(backend, "probeHostColors");
    const service = new TerminalColorsService(themeService, configuration, backend);
    const changes = vi.fn();
    service.onDidChange(changes);
    return { service, themeService, configuration, probe, changes };
}

describe("resolveTerminalColors", () => {
    it("тема: 16 цветов — terminal.ansi* (дефолты эталона), фон/текст — токены темы", () => {
        expect(resolveTerminalColors(DARK, "theme", undefined)).toEqual({
            ansi: VSCODE_DARK_ANSI,
            background: undefined,
            foreground: undefined,
        });
    });

    it("светлая тема даёт свои дефолты эталона", () => {
        const { ansi } = resolveTerminalColors(LIGHT, "theme", undefined);
        expect(ansi[2]).toBe(0x107c10); // ansiGreen light
        expect(ansi[7]).toBe(0x555555); // ansiWhite light
    });

    it("тема с terminal.ansi* перекрывает дефолты", () => {
        const theme = WorkbenchTheme.fromThemeFile({
            ...darkPlusTheme,
            colors: { ...darkPlusTheme.colors, "terminal.ansiRed": "#ff0000" },
        });
        expect(resolveTerminalColors(theme, "theme", undefined).ansi[1]).toBe(0xff0000);
    });

    it("в режиме темы ответ хоста игнорируется", () => {
        expect(resolveTerminalColors(DARK, "theme", PARTIAL_HOST).ansi).toEqual(VSCODE_DARK_ANSI);
    });

    it("хост: сообщённое — от хоста, остальное поштучно из темы", () => {
        const colors = resolveTerminalColors(DARK, "host", PARTIAL_HOST);
        expect(colors.ansi[1]).toBe(packRgb(200, 0, 0));
        expect(colors.ansi[15]).toBe(packRgb(250, 250, 250));
        expect(colors.ansi[2]).toBe(VSCODE_DARK_ANSI[2]);
        expect(colors.background).toBe(packRgb(1, 2, 3));
        expect(colors.foreground).toBeUndefined();
    });

    it("хост ещё не ответил — всё из темы", () => {
        expect(resolveTerminalColors(DARK, "host", undefined)).toEqual(resolveTerminalColors(DARK, "theme", undefined));
    });
});

describe("TerminalColorsService", () => {
    it("по умолчанию — тема, хост-терминал не спрашивается", () => {
        const { service, probe } = build();
        expect(service.colors.ansi).toEqual(VSCODE_DARK_ANSI);
        expect(probe).not.toHaveBeenCalled();
    });

    it("colorSource=host на старте: спрашивает хост один раз и отдаёт его цвета", () => {
        const { service, probe } = build({ "terminal.integrated.colorSource": "host" }, PARTIAL_HOST);
        expect(probe).toHaveBeenCalledOnce();
        expect(service.colors.ansi[1]).toBe(packRgb(200, 0, 0));
        expect(service.colors.background).toBe(packRgb(1, 2, 3));
    });

    it("смена темы перекрашивает: новое событие с палитрой новой темы", () => {
        const { service, themeService, changes } = build();
        themeService.setTheme(LIGHT);
        expect(changes).toHaveBeenLastCalledWith(service.colors);
        expect(service.colors.ansi[2]).toBe(0x107c10);
    });

    it("переключение на host на лету спрашивает хост; обратно на theme — без повторного опроса", async () => {
        const { service, configuration, probe, changes } = build({}, PARTIAL_HOST);

        await configuration.updateValue("terminal.integrated.colorSource", "host");
        expect(probe).toHaveBeenCalledOnce();
        expect(changes).toHaveBeenLastCalledWith(service.colors);
        expect(service.colors.ansi[1]).toBe(packRgb(200, 0, 0));

        await configuration.updateValue("terminal.integrated.colorSource", "theme");
        expect(service.colors.ansi).toEqual(VSCODE_DARK_ANSI);
        expect(service.colors.background).toBeUndefined();

        await configuration.updateValue("terminal.integrated.colorSource", "host");
        expect(probe).toHaveBeenCalledOnce();
        expect(service.colors.ansi[1]).toBe(packRgb(200, 0, 0));
    });

    it("чужие настройки событий не порождают", async () => {
        const { configuration, changes } = build();
        changes.mockClear();
        await configuration.updateValue("terminal.integrated.hideOnLastClosed", false);
        expect(changes).not.toHaveBeenCalled();
    });

    it("dispose отписывает от темы", () => {
        const { service, themeService, changes } = build();
        changes.mockClear();
        service.dispose();
        themeService.setTheme(LIGHT);
        expect(changes).not.toHaveBeenCalled();
    });
});
