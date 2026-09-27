import { packRgb } from "@tuidom/core/common/colorUtils";
import { describe, expect, it } from "vitest";

import { createLoggerSpy, extensionWithThemes, MemoryAssets } from "../../../../../TestUtils/themeExtensionFixture.ts";
import { ThemeRegistry } from "../../themes/common/themeRegistry.ts";
import { TokenThemeResolver } from "../../themes/common/tokenThemeResolver.ts";

import { ExtensionThemeContributor } from "./extensionThemeContributor.ts";

const EXT = "test.formats";
const LOCATION = `UserExtensions/${EXT}-1.0.0/`;

async function applyThemes(
    themes: readonly unknown[],
    files: Partial<Record<string, string>>,
): Promise<{ registry: ThemeRegistry; logger: ReturnType<typeof createLoggerSpy>; assets: MemoryAssets }> {
    const ext = extensionWithThemes(EXT, themes);
    const assets = new MemoryAssets(
        Object.fromEntries(Object.entries(files).map(([rel, text]) => [`${LOCATION}${rel}`, text])),
    );
    const registry = new ThemeRegistry();
    const logger = createLoggerSpy();
    await new ExtensionThemeContributor(assets, [ext], registry, logger).apply();
    return { registry, logger, assets };
}

describe("ExtensionThemeContributor — формат файла темы", () => {
    it("US-13: include внутри расширения — фон из включающей, остальное из базы", async () => {
        const { registry } = await applyThemes(
            [
                { label: "Sample Dark", uiTheme: "vs-dark", path: "./themes/sample-dark.json" },
                { label: "Sample Dimmed", uiTheme: "vs-dark", path: "./themes/sample-dimmed.json" },
            ],
            {
                "themes/sample-dark.json": JSON.stringify({
                    colors: { "editor.background": "#101820", "statusBar.background": "#0A0F14" },
                    tokenColors: [{ scope: "keyword", settings: { foreground: "#FF00FF" } }],
                }),
                "themes/sample-dimmed.json": JSON.stringify({
                    include: "./sample-dark.json",
                    colors: { "editor.background": "#0B1015" },
                }),
            },
        );

        const dimmed = registry.resolve("Sample Dimmed");
        expect(dimmed?.getRequiredColor("editor.background")).toBe(packRgb(0x0b, 0x10, 0x15));
        expect(dimmed?.getRequiredColor("statusBar.background")).toBe(packRgb(0x0a, 0x0f, 0x14));
        expect(new TokenThemeResolver(dimmed!.tokenTheme).resolve(["keyword"]).fg).toBe(packRgb(0xff, 0x00, 0xff));
        // База осталась самостоятельной темой со своим фоном.
        expect(registry.resolve("Sample Dark")?.getRequiredColor("editor.background")).toBe(packRgb(0x10, 0x18, 0x20));
    });

    it("include резолвится относительно файла темы, с подъёмом по `..` внутри расширения", async () => {
        const { registry, assets } = await applyThemes(
            [{ label: "Nested", uiTheme: "vs-dark", path: "./themes/nested/child.json" }],
            {
                "themes/nested/child.json": JSON.stringify({ include: "../base.json", colors: {} }),
                // Лишний `/` и `./` в середине нормализуются, как у path.posix.
                "themes/base.json": JSON.stringify({ include: ".//../shared/./root.json", colors: { a: "#111111" } }),
                "shared/root.json": JSON.stringify({ colors: { "editor.background": "#ABCDEF" } }),
            },
        );

        expect(registry.resolve("Nested")?.getRequiredColor("editor.background")).toBe(packRgb(0xab, 0xcd, 0xef));
        expect(assets.reads).toEqual([
            `${LOCATION}themes/nested/child.json`,
            `${LOCATION}themes/base.json`,
            `${LOCATION}shared/root.json`,
        ]);
    });

    it("include, выходящий за пределы расширения, — ошибка и пропуск темы", async () => {
        const { registry, logger } = await applyThemes(
            [
                { label: "Escaping", uiTheme: "vs-dark", path: "./themes/a.json" },
                { label: "Escaping Root", uiTheme: "vs-dark", path: "./b.json" },
            ],
            {
                "themes/a.json": JSON.stringify({ include: "../../other-ext/theme.json", colors: {} }),
                "b.json": JSON.stringify({ include: "../../../x.json", colors: {} }),
            },
        );

        expect(registry.list()).toEqual([]);
        expect(logger.error).toHaveBeenCalledWith(
            `${EXT}: theme "Escaping" skipped — include "../../other-ext/theme.json" escapes the extension`,
        );
        expect(logger.error).toHaveBeenCalledWith(
            `${EXT}: theme "Escaping Root" skipped — include "../../../x.json" escapes the extension`,
        );
    });

    it("US-14: JSONC — комментарии и висячие запятые читаются", async () => {
        const { registry, logger } = await applyThemes(
            [{ label: "Commented", uiTheme: "vs-dark", path: "./theme.jsonc" }],
            {
                "theme.jsonc": `{
                    // цвета
                    "colors": { "editor.background": "#123456", },
                    "tokenColors": [ /* пусто */ ],
                }`,
            },
        );

        expect(registry.resolve("Commented")?.getRequiredColor("editor.background")).toBe(packRgb(0x12, 0x34, 0x56));
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("US-15: битый JSON, path в никуда и цикл include — по ошибке в лог на каждую, остальные темы живы", async () => {
        const { registry, logger } = await applyThemes(
            [
                { label: "Broken JSON", uiTheme: "vs-dark", path: "./broken.json" },
                { label: "Missing", uiTheme: "vs-dark", path: "./nope/missing.json" },
                { label: "Cyclic", uiTheme: "vs-dark", path: "./cycle-a.json" },
                { label: "Healthy", uiTheme: "vs", path: "./healthy.json" },
            ],
            {
                "broken.json": `{ "colors": { "editor.background": #fff } }`,
                "cycle-a.json": JSON.stringify({ include: "./cycle-b.json", colors: {} }),
                "cycle-b.json": JSON.stringify({ include: "./cycle-a.json", colors: {} }),
                "healthy.json": JSON.stringify({ colors: { "editor.background": "#FFFFFF" } }),
            },
        );

        expect(registry.list()).toEqual([{ label: "Healthy", type: "light" }]);
        const errors = logger.error.mock.calls.map((call: unknown[]) => call[0] as string);
        expect(errors).toHaveLength(3);
        expect(errors[0]).toMatch(
            new RegExp(
                `^${EXT}: theme "Broken JSON" skipped — ${LOCATION}broken.json: invalid JSON: .* at offset \\d+$`,
            ),
        );
        expect(errors[1]).toBe(
            `${EXT}: theme "Missing" skipped — cannot read ${LOCATION}nope/missing.json: ENOENT: no asset ${LOCATION}nope/missing.json`,
        );
        expect(errors[2]).toBe(
            `${EXT}: theme "Cyclic" skipped — include cycle: ${LOCATION}cycle-a.json → ${LOCATION}cycle-b.json → ${LOCATION}cycle-a.json`,
        );
    });

    it("цикл include на самого себя тоже ловится", async () => {
        const { registry, logger } = await applyThemes([{ label: "Self", uiTheme: "vs-dark", path: "./self.json" }], {
            "self.json": JSON.stringify({ include: "./self.json", colors: {} }),
        });

        expect(registry.list()).toEqual([]);
        expect(logger.error).toHaveBeenCalledWith(
            `${EXT}: theme "Self" skipped — include cycle: ${LOCATION}self.json → ${LOCATION}self.json`,
        );
    });

    it("US-16: uiTheme определяет тип; отсутствующий или неизвестный → dark с warning", async () => {
        const file = JSON.stringify({ colors: {} });
        const { registry, logger } = await applyThemes(
            [
                { label: "L", uiTheme: "vs", path: "./t.json" },
                { label: "D", uiTheme: "vs-dark", path: "./t.json" },
                { label: "HC", uiTheme: "hc-black", path: "./t.json" },
                { label: "HCL", uiTheme: "hc-light", path: "./t.json" },
                { label: "None", path: "./t.json" },
                { label: "Odd", uiTheme: "vs-sepia", path: "./t.json" },
            ],
            { "t.json": file },
        );

        expect(registry.list()).toEqual([
            { label: "L", type: "light" },
            { label: "D", type: "dark" },
            { label: "HC", type: "hc" },
            { label: "HCL", type: "hcLight" },
            { label: "None", type: "dark" },
            { label: "Odd", type: "dark" },
        ]);
        expect(logger.warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
            `${EXT}: theme "None": unknown uiTheme undefined — treated as dark`,
            `${EXT}: theme "Odd": unknown uiTheme "vs-sepia" — treated as dark`,
        ]);
    });

    it("US-17: tokenColors строкой (.tmTheme) — тема в реестре с цветами workbench и дефолтной подсветкой, warning", async () => {
        const { registry, logger } = await applyThemes([{ label: "Plist", uiTheme: "vs-dark", path: "./plist.json" }], {
            "plist.json": JSON.stringify({
                colors: { "editor.background": "#0F0F0F" },
                tokenColors: "./Plist.tmTheme",
            }),
        });

        const theme = registry.resolve("Plist");
        expect(theme?.getRequiredColor("editor.background")).toBe(packRgb(0x0f, 0x0f, 0x0f));
        expect(theme?.tokenTheme.rules).toEqual([]);
        expect(logger.warn).toHaveBeenCalledWith(
            `${EXT}: theme "Plist" (${LOCATION}plist.json): tokenColors "./Plist.tmTheme": tmTheme tokenColors are not supported — syntax colors fall back to defaults`,
        );
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("невалидный цвет в файле — warning с путём файла, тема регистрируется и резолвится", async () => {
        const { registry, logger } = await applyThemes([{ label: "Sloppy", uiTheme: "vs-dark", path: "./s.json" }], {
            "s.json": JSON.stringify({ colors: { "editor.background": "#0F0F0F", "bad.key": "orange" } }),
        });

        expect(registry.resolve("Sloppy")?.getRequiredColor("editor.background")).toBe(packRgb(0x0f, 0x0f, 0x0f));
        expect(logger.warn).toHaveBeenCalledWith(
            `${EXT}: theme "Sloppy" (${LOCATION}s.json): colors["bad.key"]: invalid color "orange" — ignored`,
        );
    });

    it("запись без label или без path пропускается с warning (решение 1)", async () => {
        const { registry, logger, assets } = await applyThemes(
            [
                { uiTheme: "vs-dark", path: "./t.json" },
                { label: "", path: "./t.json" },
                { label: "No Path" },
                { label: "Empty Path", path: "" },
                "not-an-object",
                null,
                { label: "Fine", uiTheme: "vs-dark", path: "./t.json" },
            ],
            { "t.json": JSON.stringify({ colors: {} }) },
        );

        expect(registry.list()).toEqual([{ label: "Fine", type: "dark" }]);
        expect(assets.reads).toEqual([`${LOCATION}t.json`]);
        expect(logger.warn.mock.calls.map((call: unknown[]) => call[0])).toEqual(
            [0, 1, 2, 3, 4, 5].map(
                (index) =>
                    `${EXT}: contributes.themes[${String(index)}] skipped — "label" and "path" must be non-empty strings`,
            ),
        );
    });

    it("contributes.themes не массив — молча игнорируется", async () => {
        const ext = extensionWithThemes(EXT, []);
        const manifest = { ...ext.manifest, contributes: { themes: { label: "x" } } } as unknown as typeof ext.manifest;
        const registry = new ThemeRegistry();
        const logger = createLoggerSpy();
        await new ExtensionThemeContributor(new MemoryAssets({}), [{ ...ext, manifest }], registry, logger).apply();

        expect(registry.list()).toEqual([]);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("не-Error при чтении ассета превращается в строку причины", async () => {
        const ext = extensionWithThemes(EXT, [{ label: "Odd Reject", uiTheme: "vs-dark", path: "./t.json" }]);
        const assets = new MemoryAssets({});
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- не-Error по замыслу теста
        assets.readText = () => Promise.reject("socket hung up");
        const registry = new ThemeRegistry();
        const logger = createLoggerSpy();
        await new ExtensionThemeContributor(assets, [ext], registry, logger).apply();

        expect(logger.error).toHaveBeenCalledWith(
            `${EXT}: theme "Odd Reject" skipped — cannot read ${LOCATION}t.json: socket hung up`,
        );
    });
});
