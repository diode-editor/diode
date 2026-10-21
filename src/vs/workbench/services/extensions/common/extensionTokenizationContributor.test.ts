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
    it("registers tokenization support for all languages from builtin extensions", async () => {
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

    it("theme before apply(): TypeScript colors `const` with the theme's storage.type color", async () => {
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

    it("theme change: grammars recolor, the registry gets colorMap and retokenizes languages", async () => {
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

    it("the same theme again — no retokenization", async () => {
        const assets = createDevAssetAccess();
        const exts = await scanBuiltinExtensions(assets, ROOT_PREFIX);
        const registry = new TokenizationRegistry();
        const contributor = new ExtensionTokenizationContributor(assets, exts, registry);
        contributor.apply();
        contributor.setTheme(createTextMateTheme(builtinTheme("Dark Modern")));
        await registry.load("typescript");
        const changed: string[] = [];
        registry.onDidChange((languageId) => changed.push(languageId));

        // A new object with the same rules and colors, like a repeated onThemeChange.
        contributor.setTheme(createTextMateTheme(builtinTheme("Dark Modern")));

        expect(changed).toEqual([]);
        contributor.dispose();
    });

    it("dispose() removes registrations from TokenizationRegistry", async () => {
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

    // Guards against eager parsing: 77 builtin grammars are 6.6 MB of JSON.
    it("apply() reads no assets — the grammar is parsed only on load()", async () => {
        const assets = createDevAssetAccess();
        const exts = await scanBuiltinExtensions(assets, ROOT_PREFIX);
        const registry = new TokenizationRegistry();
        const readText = vi.spyOn(assets, "readText");
        const contributor = new ExtensionTokenizationContributor(assets, exts, registry);

        contributor.apply();
        expect(readText).not.toHaveBeenCalled();

        await registry.load("typescript");
        expect(readText).toHaveBeenCalled();
        expect(registry.get("css")).toBeUndefined();

        contributor.dispose();
        readText.mockRestore();
    });

    it("preloadAll() warms up the remaining languages", async () => {
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

    it("dispose() before load() — the factory registers nothing", async () => {
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
