import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point } from "@tuidom/core/common/geometryPromitives";
import type { HFlexElement } from "@tuidom/elements/layout/hFlexElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createLoggerSpy, extensionWithThemes, MemoryAssets } from "../../../TestUtils/themeExtensionFixture.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";
import { ExtensionThemeContributor } from "../services/extensions/common/extensionThemeContributor.ts";
import { createBuiltinThemeRegistry } from "../services/themes/common/themeRegistry.ts";
import { DEFAULT_COLOR_THEME } from "../services/themes/common/themes/builtinThemes.ts";
import { ThemeService } from "../services/themes/common/themeService.ts";
import { ThemeRegistryDIToken, ThemeServiceDIToken } from "../services/themes/common/themeTokens.ts";

/**
 * US-3: тема расширения из `workbench.colorTheme` — уже в **первом** кадре.
 *
 * Порядок старта (`main.ts`): сканирование расширений → регистрация их тем →
 * выбор активной → контейнер → mount → первый кадр. Здесь та же цепочка на
 * харнессе: контрибьютор на синтетическом расширении в памяти, реестр и
 * выбранная по настройке тема уходят в контейнер ДО резолва WorkbenchComponent,
 * и первый отрендеренный кадр (TestApp рендерит его в конструкторе) читается с
 * бэкенда как есть — никакого «в итоге» после перекраса.
 */

const SAMPLE_EDITOR_BG = "#101820";
const SAMPLE_STATUS_BG = "#0A0F14";

async function startupThemes(colorTheme: string): Promise<{
    theme: ReturnType<ReturnType<typeof createBuiltinThemeRegistry>["resolve"]>;
    registry: ReturnType<typeof createBuiltinThemeRegistry>;
    logger: ReturnType<typeof createLoggerSpy>;
}> {
    const ext = extensionWithThemes("test.sample-theme", [
        { label: "Sample Dark", uiTheme: "vs-dark", path: "./themes/sample-dark.json" },
    ]);
    const assets = new MemoryAssets({
        [`${ext.location}themes/sample-dark.json`]: JSON.stringify({
            colors: { "editor.background": SAMPLE_EDITOR_BG, "statusBar.background": SAMPLE_STATUS_BG },
        }),
    });
    const registry = createBuiltinThemeRegistry();
    const logger = createLoggerSpy();
    await new ExtensionThemeContributor(assets, [ext], registry, logger).apply();
    // Та же развилка, что в main.ts: ненайденная тема → дефолт + warning.
    let theme = registry.resolve(colorTheme);
    if (theme === undefined) {
        logger.warn(`Color theme "${colorTheme}" not found, falling back to "${DEFAULT_COLOR_THEME}"`);
        theme = registry.resolve(DEFAULT_COLOR_THEME);
    }
    return { theme, registry, logger };
}

describe("Workbench — тема расширения на старте (US-3)", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness | undefined;

    beforeEach(() => {
        ws = createTempWorkspace({ files: { "sample.ts": "const answer = 42;\n" } });
    });

    afterEach(() => {
        h?.dispose();
        h = undefined;
        ws.dispose();
    });

    it("первый кадр уже в Sample Dark: фон редактора и статус-бара — цвета из файла темы расширения", async () => {
        const { theme, registry } = await startupThemes("Sample Dark");
        expect(theme?.name).toBe("Sample Dark");

        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            containerOverrides: (container) => {
                container.bind(ThemeServiceDIToken, () => new ThemeService(theme!));
                container.bind(ThemeRegistryDIToken, () => registry);
            },
        });

        // Кадр, который бэкенд получил ПЕРВЫМ: TestApp отрендерил его при
        // создании, никаких sendKey/render между ним и этим чтением нет.
        const statusBar = h.testApp.querySelector("#statusBar") as HFlexElement;
        const statusOrigin = statusBar.globalPosition;
        expect(h.testApp.backend.getBgAt(new Point(statusOrigin.x, statusOrigin.y))).toBe(packRgb(0x0a, 0x0f, 0x14));

        // Открытый файл — тем же цветом редактора из файла темы.
        h.workbench.openFile(`${ws.dir}/sample.ts`);
        h.testApp.render();
        const editor = h.testApp.querySelector("EditorElement") as EditorElement;
        const editorOrigin = editor.globalPosition;
        // Вторая (пустая) строка: на первой слово под кареткой подсвечено
        // occurrence-фоном, а не фоном редактора.
        const contentX = editorOrigin.x + editor.gutterWidth;
        expect(h.testApp.backend.getBgAt(new Point(contentX + 2, editorOrigin.y + 1))).toBe(packRgb(0x10, 0x18, 0x20));
        // Тема расширения — в реестре пикера вслед за встроенными.
        expect(h.container.get(ThemeRegistryDIToken).list().at(-1)).toEqual({ label: "Sample Dark", type: "dark" });
    });

    it("US-5: тема из настроек не установлена — первый кадр в Dark Modern, в логе откат с именем темы", async () => {
        const { theme, logger } = await startupThemes("Missing Theme");
        expect(theme?.name).toBe(DEFAULT_COLOR_THEME);
        expect(logger.warn).toHaveBeenCalledWith(
            'Color theme "Missing Theme" not found, falling back to "Dark Modern"',
        );

        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            containerOverrides: (container) => {
                container.bind(ThemeServiceDIToken, () => new ThemeService(theme!));
            },
        });
        // Dark Modern: statusBar.background #181818 — уже в первом кадре.
        const statusBar = h.testApp.querySelector("#statusBar") as HFlexElement;
        const statusOrigin = statusBar.globalPosition;
        expect(h.testApp.backend.getBgAt(new Point(statusOrigin.x, statusOrigin.y))).toBe(packRgb(0x18, 0x18, 0x18));
    });
});
