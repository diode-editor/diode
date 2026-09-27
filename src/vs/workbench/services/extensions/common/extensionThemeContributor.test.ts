import { packRgb, packRgba } from "@tuidom/core/common/colorUtils";
import { describe, expect, it, vi } from "vitest";

import { createLoggerSpy, extensionWithThemes, MemoryAssets } from "../../../../../TestUtils/themeExtensionFixture.ts";
import type { IAssetAccess } from "../../../../base/common/assets/iAssetAccess.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import { createBuiltinThemeRegistry, ThemeRegistry } from "../../themes/common/themeRegistry.ts";
import { builtinThemes } from "../../themes/common/themes/builtinThemes.ts";
import { TokenThemeResolver } from "../../themes/common/tokenThemeResolver.ts";

import { ExtensionThemeContributor } from "./extensionThemeContributor.ts";

const SAMPLE_DARK = JSON.stringify({
    name: "Inner Sample Name",
    colors: {
        "editor.background": "#101820",
        "statusBar.background": "#0A0F14",
        "editor.selectionBackground": "#9399b240",
    },
    tokenColors: [{ scope: "keyword", settings: { foreground: "#FF00FF" } }],
});
const SAMPLE_LIGHT = JSON.stringify({ colors: { "editor.background": "#FAFAFA" } });

function sampleExtension(id = "test.sample-theme"): { ext: IExtension; assets: MemoryAssets } {
    const ext = extensionWithThemes(id, [
        { label: "Sample Dark", uiTheme: "vs-dark", path: "./themes/sample-dark.json" },
        { label: "Sample Light", uiTheme: "vs", path: "themes/sample-light.json" },
    ]);
    const assets = new MemoryAssets({
        [`${ext.location}themes/sample-dark.json`]: SAMPLE_DARK,
        [`${ext.location}themes/sample-light.json`]: SAMPLE_LIGHT,
    });
    return { ext, assets };
}

describe("ExtensionThemeContributor — регистрация тем расширений", () => {
    it("темы расширения встают в реестр вслед за встроенными, с типом из uiTheme", async () => {
        const { ext, assets } = sampleExtension();
        const registry = createBuiltinThemeRegistry();
        const contributor = new ExtensionThemeContributor(assets, [ext], registry);

        await contributor.apply();

        expect(registry.list().slice(builtinThemes.length)).toEqual([
            { label: "Sample Dark", type: "dark" },
            { label: "Sample Light", type: "light" },
        ]);
    });

    it("ключ темы — label из манифеста, name из файла игнорируется (US-4)", async () => {
        const { ext, assets } = sampleExtension();
        const registry = new ThemeRegistry();
        await new ExtensionThemeContributor(assets, [ext], registry).apply();

        expect(registry.has("Sample Dark")).toBe(true);
        expect(registry.has("Inner Sample Name")).toBe(false);
        expect(registry.resolve("Sample Dark")?.name).toBe("Sample Dark");
    });

    it("resolve() даёт цвета workbench из файла, включая альфу, и правила подсветки", async () => {
        const { ext, assets } = sampleExtension();
        const registry = new ThemeRegistry();
        await new ExtensionThemeContributor(assets, [ext], registry).apply();

        const theme = registry.resolve("Sample Dark");
        expect(theme?.getRequiredColor("editor.background")).toBe(packRgb(0x10, 0x18, 0x20));
        expect(theme?.getRequiredColor("statusBar.background")).toBe(packRgb(0x0a, 0x0f, 0x14));
        expect(theme?.getRequiredColor("editor.selectionBackground")).toBe(packRgba(0x93, 0x99, 0xb2, 0x40));
        // Правило `keyword` из файла темы доходит до резолвера подсветки (US-8).
        const resolver = new TokenThemeResolver(theme!.tokenTheme);
        expect(resolver.resolve(["source.ts", "keyword.control.ts"]).fg).toBe(packRgb(0xff, 0x00, 0xff));
    });

    it("все файлы читаются в apply(), до первого кадра — resolve синхронный и без I/O", async () => {
        const { ext, assets } = sampleExtension();
        const registry = new ThemeRegistry();
        await new ExtensionThemeContributor(assets, [ext], registry).apply();

        expect(assets.reads).toEqual([
            `${ext.location}themes/sample-dark.json`,
            `${ext.location}themes/sample-light.json`,
        ]);
        assets.reads.length = 0;
        registry.resolve("Sample Dark");
        registry.resolve("Sample Light");
        expect(assets.reads).toEqual([]);
    });

    it("расширение без contributes.themes ничего не регистрирует и ничего не читает", async () => {
        const ext: IExtension = {
            id: "test.plain",
            location: "UserExtensions/test.plain-1.0.0/",
            isBuiltin: false,
            manifest: { name: "plain", publisher: "test", version: "1.0.0", engines: { vscode: "*" } },
        };
        const assets = new MemoryAssets({});
        const registry = new ThemeRegistry();
        await new ExtensionThemeContributor(assets, [ext], registry).apply();

        expect(registry.list()).toEqual([]);
        expect(assets.reads).toEqual([]);
    });

    it("US-11: label встроенной темы — побеждает расширение, warning о затенении", async () => {
        const ext = extensionWithThemes("test.shadow", [{ label: "Monokai", uiTheme: "vs-dark", path: "./mono.json" }]);
        const assets = new MemoryAssets({
            [`${ext.location}mono.json`]: JSON.stringify({ colors: { "editor.background": "#ABCDEF" } }),
        });
        const registry = createBuiltinThemeRegistry();
        const logger = createLoggerSpy();
        await new ExtensionThemeContributor(assets, [ext], registry, logger).apply();

        expect(registry.list().filter((d) => d.label === "Monokai")).toHaveLength(1);
        expect(registry.resolve("Monokai")?.getRequiredColor("editor.background")).toBe(packRgb(0xab, 0xcd, 0xef));
        expect(logger.warn).toHaveBeenCalledWith('test.shadow: theme "Monokai" shadows the built-in theme');
    });

    it("US-12: два расширения с одним label — побеждает последнее по порядку скана, warning с обоими id", async () => {
        const first = extensionWithThemes("a.first", [{ label: "Twin", uiTheme: "vs-dark", path: "./t.json" }]);
        const second = extensionWithThemes("b.second", [{ label: "Twin", uiTheme: "vs", path: "./t.json" }]);
        const assets = new MemoryAssets({
            [`${first.location}t.json`]: JSON.stringify({ colors: { "editor.background": "#111111" } }),
            [`${second.location}t.json`]: JSON.stringify({ colors: { "editor.background": "#222222" } }),
        });
        const registry = new ThemeRegistry();
        const logger = createLoggerSpy();
        await new ExtensionThemeContributor(assets, [first, second], registry, logger).apply();

        expect(registry.list()).toEqual([{ label: "Twin", type: "light" }]);
        expect(registry.resolve("Twin")?.getRequiredColor("editor.background")).toBe(packRgb(0x22, 0x22, 0x22));
        expect(logger.warn).toHaveBeenCalledWith(
            'b.second: theme "Twin" shadows the theme with the same label from a.first',
        );
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("порядок регистрации — порядок расширений, даже если их файлы читаются с разной скоростью", async () => {
        const slow = extensionWithThemes("a.slow", [{ label: "Slow", uiTheme: "vs-dark", path: "./t.json" }]);
        const fast = extensionWithThemes("b.fast", [{ label: "Fast", uiTheme: "vs-dark", path: "./t.json" }]);
        const files: Partial<Record<string, string>> = {
            [`${slow.location}t.json`]: JSON.stringify({ colors: {} }),
            [`${fast.location}t.json`]: JSON.stringify({ colors: {} }),
        };
        const assets = new MemoryAssets(files);
        const delayed: IAssetAccess = {
            read: (p) => assets.read(p),
            exists: (p) => assets.exists(p),
            listEntries: () => assets.listEntries(),
            readText: (p) =>
                p.startsWith(slow.location)
                    ? new Promise((resolve) =>
                          setTimeout(() => {
                              resolve(assets.readText(p));
                          }, 5),
                      )
                    : assets.readText(p),
        };
        const registry = new ThemeRegistry();
        await new ExtensionThemeContributor(delayed, [slow, fast], registry).apply();

        expect(registry.list().map((d) => d.label)).toEqual(["Slow", "Fast"]);
    });

    it("dispose() снимает ровно свои регистрации, встроенные остаются", async () => {
        const { ext, assets } = sampleExtension();
        const registry = createBuiltinThemeRegistry();
        const unregister = vi.spyOn(registry, "unregister");
        const contributor = new ExtensionThemeContributor(assets, [ext], registry);
        await contributor.apply();
        expect(registry.has("Sample Dark")).toBe(true);

        contributor.dispose();

        expect(registry.has("Sample Dark")).toBe(false);
        expect(registry.has("Sample Light")).toBe(false);
        expect(registry.list()).toHaveLength(builtinThemes.length);
        expect(unregister.mock.calls).toEqual([["Sample Dark"], ["Sample Light"]]);
        // Повторный dispose — no-op: снимать больше нечего.
        contributor.dispose();
        expect(unregister).toHaveBeenCalledTimes(2);
        expect(registry.list()).toHaveLength(builtinThemes.length);
    });

    it("без логгера все ветки предупреждений и ошибок молчат, а не падают", async () => {
        const shadow = extensionWithThemes("a.shadow", [
            { label: "Monokai", path: "./mono.json" },
            { label: "Twin", uiTheme: "vs-sepia", path: "./twin.json" },
            { label: "Broken", uiTheme: "vs-dark", path: "./broken.json" },
            { label: "Sloppy", uiTheme: "vs-dark", path: "./sloppy.json" },
            { path: "./no-label.json" },
        ]);
        const twin = extensionWithThemes("b.twin", [{ label: "Twin", uiTheme: "vs", path: "./twin.json" }]);
        const assets = new MemoryAssets({
            [`${shadow.location}mono.json`]: JSON.stringify({ colors: {} }),
            [`${shadow.location}twin.json`]: JSON.stringify({ colors: {} }),
            [`${shadow.location}broken.json`]: "{ not json",
            [`${shadow.location}sloppy.json`]: JSON.stringify({ colors: { a: "red" } }),
            [`${twin.location}twin.json`]: JSON.stringify({ colors: {} }),
        });
        const registry = createBuiltinThemeRegistry();

        await new ExtensionThemeContributor(assets, [shadow, twin], registry).apply();

        expect(registry.list().slice(builtinThemes.length)).toEqual([
            { label: "Twin", type: "light" },
            { label: "Sloppy", type: "dark" },
        ]);
        expect(registry.list().filter((d) => d.label === "Monokai")).toHaveLength(1);
    });
});
