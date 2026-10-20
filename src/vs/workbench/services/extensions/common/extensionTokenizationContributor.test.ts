import { describe, expect, it, vi } from "vitest";

import { createDevAssetAccess } from "../../../../base/node/assets/createDefaultAssetAccess.ts";
import { TokenMetadata } from "../../../../editor/common/encodedTokenAttributes.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { scanBuiltinExtensions } from "../../../../platform/extensions/common/extensionScanner.ts";
import type { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { createTextMateTheme } from "../../themes/common/textMateTheme.ts";
import { createBuiltinThemeRegistry } from "../../themes/common/themeRegistry.ts";

import { ExtensionTokenizationContributor } from "./extensionTokenizationContributor.ts";

const ROOT_PREFIX = "Extensions/builtin/";

function builtinTheme(label: string): WorkbenchTheme {
    const theme = createBuiltinThemeRegistry().resolve(label);
    if (theme === undefined) throw new Error(`${label} missing`);
    return theme;
}

describe("ExtensionTokenizationContributor", () => {
    it("регистрирует tokenization support для всех языков из builtin-расширений", async () => {
        const assets = createDevAssetAccess();
        const exts = await scanBuiltinExtensions(assets, ROOT_PREFIX);
        expect(exts.length).toBeGreaterThan(0);

        const registry = new TokenizationRegistry();
        const contributor = new ExtensionTokenizationContributor(assets, exts, registry);
        contributor.apply();

        for (const lang of ["javascript", "javascriptreact", "typescript", "typescriptreact", "css"]) {
            expect(await registry.load(lang), `${lang} must be loadable`).toBeDefined();
        }
        contributor.dispose();
    });

    it("тема до apply(): TypeScript красит `const` цветом storage.type темы", async () => {
        const assets = createDevAssetAccess();
        const exts = await scanBuiltinExtensions(assets, ROOT_PREFIX);
        const registry = new TokenizationRegistry();
        const contributor = new ExtensionTokenizationContributor(assets, exts, registry);
        const theme = createTextMateTheme(builtinTheme("Dark Modern"));
        contributor.setTheme(theme);
        contributor.apply();

        const ts = await registry.load("typescript");
        expect(ts).toBeDefined();
        const result = ts!.tokenizeEncoded("const x = 1;", true, ts!.getInitialState());
        expect(result.tokens[0]).toBe(0);
        expect(theme.colorMap[TokenMetadata.getForeground(result.tokens[1])]).toBe("#569CD6");
        expect(registry.getColorMap()).toBe(theme.colorMap);

        contributor.dispose();
    });

    it("смена темы: грамматики перекрашиваются, реестр получает colorMap и перетокенизирует языки", async () => {
        const assets = createDevAssetAccess();
        const exts = await scanBuiltinExtensions(assets, ROOT_PREFIX);
        const registry = new TokenizationRegistry();
        const contributor = new ExtensionTokenizationContributor(assets, exts, registry);
        contributor.apply();
        contributor.setTheme(createTextMateTheme(builtinTheme("Dark Modern")));
        const ts = await registry.load("typescript");
        const changed: string[] = [];
        registry.onDidChange((languageId) => changed.push(languageId));

        const light = createTextMateTheme(builtinTheme("Light Modern"));
        contributor.setTheme(light);

        expect(changed).toEqual(["typescript"]);
        expect(registry.getColorMap()).toBe(light.colorMap);
        const result = ts!.tokenizeEncoded("const x", true, ts!.getInitialState());
        expect(light.colorMap[TokenMetadata.getForeground(result.tokens[1])]).toBe("#0000FF");

        contributor.dispose();
    });

    it("та же тема повторно — без перетокенизации", async () => {
        const assets = createDevAssetAccess();
        const exts = await scanBuiltinExtensions(assets, ROOT_PREFIX);
        const registry = new TokenizationRegistry();
        const contributor = new ExtensionTokenizationContributor(assets, exts, registry);
        contributor.apply();
        contributor.setTheme(createTextMateTheme(builtinTheme("Dark Modern")));
        await registry.load("typescript");
        const changed: string[] = [];
        registry.onDidChange((languageId) => changed.push(languageId));

        // Новый объект с теми же правилами и цветами — как повторный onThemeChange.
        contributor.setTheme(createTextMateTheme(builtinTheme("Dark Modern")));

        expect(changed).toEqual([]);
        contributor.dispose();
    });

    it("dispose() убирает регистрации из TokenizationRegistry", async () => {
        const assets = createDevAssetAccess();
        const exts = await scanBuiltinExtensions(assets, ROOT_PREFIX);
        const registry = new TokenizationRegistry();
        const contributor = new ExtensionTokenizationContributor(assets, exts, registry);
        contributor.apply();
        expect(await registry.load("typescript")).toBeDefined();
        expect(registry.get("typescript")).toBeDefined();

        contributor.dispose();
        expect(registry.get("typescript")).toBeUndefined();
    });

    // Регрессионный замок на eager-парсинг: 77 builtin-грамматик — это 6.6 MB
    // JSON, и открытие одного .ts не должно их трогать.
    it("apply() не читает ассеты — грамматика парсится только на load()", async () => {
        const assets = createDevAssetAccess();
        const exts = await scanBuiltinExtensions(assets, ROOT_PREFIX);
        const registry = new TokenizationRegistry();
        const readText = vi.spyOn(assets, "readText");
        const contributor = new ExtensionTokenizationContributor(assets, exts, registry);

        contributor.apply();
        expect(readText).not.toHaveBeenCalled();

        await registry.load("typescript");
        expect(readText).toHaveBeenCalled();
        // Грузим только запрошенный язык, а не весь builtin-набор.
        expect(registry.get("css")).toBeUndefined();

        contributor.dispose();
        readText.mockRestore();
    });

    it("preloadAll() прогревает остальные языки", async () => {
        const assets = createDevAssetAccess();
        const exts = await scanBuiltinExtensions(assets, ROOT_PREFIX);
        const registry = new TokenizationRegistry();
        const contributor = new ExtensionTokenizationContributor(assets, exts, registry);
        contributor.apply();

        await registry.load("typescript");
        expect(registry.get("css")).toBeUndefined();

        await contributor.preloadAll();
        expect(registry.get("css")).toBeDefined();
        expect(registry.get("javascript")).toBeDefined();

        contributor.dispose();
    });

    it("dispose() до load() — фабрика ничего не регистрирует", async () => {
        const assets = createDevAssetAccess();
        const exts = await scanBuiltinExtensions(assets, ROOT_PREFIX);
        const registry = new TokenizationRegistry();
        const contributor = new ExtensionTokenizationContributor(assets, exts, registry);
        contributor.apply();
        contributor.dispose();

        expect(await registry.load("typescript")).toBeUndefined();
        expect(registry.get("typescript")).toBeUndefined();
    });
});
