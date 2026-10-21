import { describe, expect, it } from "vitest";

import { joinVirtualPath } from "../../../../base/common/assets/assetBundleFormat.ts";
import { createDevAssetAccess } from "../../../../base/node/assets/createDefaultAssetAccess.ts";
import { ColorId, TokenMetadata } from "../../../../editor/common/encodedTokenAttributes.ts";
import { scanBuiltinExtensions } from "../../../../platform/extensions/common/extensionScanner.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { createTextMateTheme } from "../../themes/common/textMateTheme.ts";
import { createBuiltinThemeRegistry } from "../../themes/common/themeRegistry.ts";

import type { IGrammarRecord } from "./textMateGrammarLoader.ts";
import { TextMateGrammarLoader } from "./textMateGrammarLoader.ts";

const assets = createDevAssetAccess();

function collectGrammarRecords(extensions: readonly IExtension[]): IGrammarRecord[] {
    const records: IGrammarRecord[] = [];
    for (const ext of extensions) {
        const grammars = ext.manifest.contributes?.grammars;
        if (grammars === undefined) continue;
        for (const grammar of grammars) {
            records.push({
                scopeName: grammar.scopeName,
                path: joinVirtualPath(ext.location, grammar.path),
                injections: grammar.injectTo,
            });
        }
    }
    return records;
}

const recordsPromise = scanBuiltinExtensions(assets, "Extensions/builtin/").then(collectGrammarRecords);

describe("TextMateGrammarLoader", () => {
    it("loads a registered grammar and produces tokens", async () => {
        const loader = new TextMateGrammarLoader(assets, await recordsPromise);
        const support = await loader.loadSupport("source.js");
        expect(support).not.toBeNull();

        const result = support!.tokenizeEncoded("const x = 1;", true, support!.getInitialState());
        expect(result.tokens.length).toBeGreaterThanOrEqual(2);
        expect(result.tokens[0]).toBe(0);
        loader.dispose();
    });

    it("returns null for an unregistered scope without touching the registry", async () => {
        const loader = new TextMateGrammarLoader(assets, await recordsPromise);
        expect(await loader.loadSupport("source.does-not-exist")).toBeNull();
        loader.dispose();
    });

    it("caches the grammar promise: two loadSupport calls return distinct support wrappers over one grammar", async () => {
        const loader = new TextMateGrammarLoader(assets, await recordsPromise);
        const a = await loader.loadSupport("source.js");
        const b = await loader.loadSupport("source.js");
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        const ra = a!.tokenizeEncoded("let y", true, a!.getInitialState());
        const rb = b!.tokenizeEncoded("let y", true, b!.getInitialState());
        expect([...ra.tokens]).toEqual([...rb.tokens]);
        loader.dispose();
    });

    it("registers injection grammars: jsdoc tag inside /** */ in source.js gets its own color", async () => {
        // Build the loader from explicit records that exercise the injection map:
        // jsdoc injects into source.js, and a second injection shares the same host
        // (so the host's injection list is appended to, hitting the list-init + push path).
        const baseRecords = await recordsPromise;
        const jsRecord = baseRecords.find((r) => r.scopeName === "source.js");
        const jsdocRecord = baseRecords.find((r) => r.injections?.includes("source.js"));
        expect(jsRecord, "source.js grammar record must exist").toBeDefined();
        expect(jsdocRecord, "a grammar injecting into source.js must exist").toBeDefined();

        const loader = new TextMateGrammarLoader(assets, baseRecords);
        const theme = createTextMateTheme(builtinTheme("Dark Modern"));
        loader.setTheme(theme);
        const support = await loader.loadSupport("source.js");
        expect(support).not.toBeNull();

        const line = "/** @param {string} x */";
        const tokens = support!.tokenizeEncoded(line, true, support!.getInitialState()).tokens;

        // Without the injection the whole comment is the comment green; jsdoc paints
        // the `@param` tag as storage.type.
        expect(colorAt(tokens, line.indexOf("@param"), theme.colorMap)).toBe("#569CD6");
        expect(colorAt(tokens, 0, theme.colorMap)).toBe("#6A9955");
        loader.dispose();
    });

    it("setTheme recolors an already loaded grammar: indices follow the new theme's colorMap", async () => {
        const loader = new TextMateGrammarLoader(assets, await recordsPromise);
        const dark = createTextMateTheme(builtinTheme("Dark Modern"));
        loader.setTheme(dark);
        const support = await loader.loadSupport("source.js");
        expect(support).not.toBeNull();
        const darkTokens = support!.tokenizeEncoded("const x", true, support!.getInitialState()).tokens;
        expect(colorAt(darkTokens, 0, dark.colorMap)).toBe("#569CD6");

        const light = createTextMateTheme(builtinTheme("Light Modern"));
        loader.setTheme(light);
        const lightTokens = support!.tokenizeEncoded("const x", true, support!.getInitialState()).tokens;
        expect(colorAt(lightTokens, 0, light.colorMap)).toBe("#0000FF");
        loader.dispose();
    });

    it("without a theme all tokens get the default color", async () => {
        const loader = new TextMateGrammarLoader(assets, await recordsPromise);
        const support = await loader.loadSupport("source.js");
        const tokens = support!.tokenizeEncoded("const x = 1; // c", true, support!.getInitialState()).tokens;
        for (let i = 1; i < tokens.length; i += 2) {
            expect(TokenMetadata.getForeground(tokens[i])).toBe(ColorId.DefaultForeground);
        }
        loader.dispose();
    });
});

function builtinTheme(label: string): WorkbenchTheme {
    const theme = createBuiltinThemeRegistry().resolve(label);
    if (theme === undefined) throw new Error(`${label} missing`);
    return theme;
}

function colorAt(tokens: Uint32Array, offset: number, colorMap: readonly string[]): string | undefined {
    let metadata = tokens[1];
    for (let i = 0; i < tokens.length; i += 2) {
        if (tokens[i] <= offset) metadata = tokens[i + 1];
    }
    return colorMap[TokenMetadata.getForeground(metadata)];
}
