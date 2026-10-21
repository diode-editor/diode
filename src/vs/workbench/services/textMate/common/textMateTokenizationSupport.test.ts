import { describe, expect, it } from "vitest";
import type { IGrammar } from "vscode-textmate";

import { joinVirtualPath } from "../../../../base/common/assets/assetBundleFormat.ts";
import { createDevAssetAccess } from "../../../../base/node/assets/createDefaultAssetAccess.ts";
import { ColorId, StandardTokenType, TokenMetadata } from "../../../../editor/common/encodedTokenAttributes.ts";
import { NULL_STATE } from "../../../../editor/common/languages/iState.ts";
import { scanBuiltinExtensions } from "../../../../platform/extensions/common/extensionScanner.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { createTextMateTheme } from "../../themes/common/textMateTheme.ts";
import { createBuiltinThemeRegistry } from "../../themes/common/themeRegistry.ts";

import type { IGrammarRecord } from "./textMateGrammarLoader.ts";
import { TextMateGrammarLoader } from "./textMateGrammarLoader.ts";
import { TextMateState } from "./textMateState.ts";
import { TextMateTokenizationSupport } from "./textMateTokenizationSupport.ts";

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

function darkModern(): WorkbenchTheme {
    const theme = createBuiltinThemeRegistry().resolve("Dark Modern");
    if (theme === undefined) throw new Error("Dark Modern missing");
    return theme;
}

const extensionsPromise = scanBuiltinExtensions(assets, "Extensions/builtin/");
const recordsPromise = extensionsPromise.then(collectGrammarRecords);

async function createLoader(): Promise<TextMateGrammarLoader> {
    return new TextMateGrammarLoader(assets, await recordsPromise);
}

describe("TextMateTokenizationSupport", () => {
    it("getInitialState() возвращает обёртку TextMateState над INITIAL", async () => {
        const loader = await createLoader();
        const support = await loader.loadSupport("source.js");
        if (!support) throw new Error("source.js not loaded");

        const state = support.getInitialState();
        expect(state).toBeInstanceOf(TextMateState);
        expect(state.equals(state)).toBe(true);
    });

    it("отдаёт бинарные токены tokenizeLine2: первый токен с нуля, цвет — индекс colorMap темы", async () => {
        const loader = await createLoader();
        const theme = createTextMateTheme(darkModern());
        loader.setTheme(theme);
        const support = await loader.loadSupport("source.js");
        if (!support) throw new Error("source.js not loaded");

        const line = "const x = 1;";
        const tokens = support.tokenizeEncoded(line, true, support.getInitialState()).tokens;

        // Pairs [start, metadata]; `const` is storage.type, blue in Dark Modern.
        expect(tokens[0]).toBe(0);
        expect(theme.colorMap[TokenMetadata.getForeground(tokens[1])]).toBe("#569CD6");
        // `1` is constant.numeric: its own color, a separate token.
        const numberIndex = line.indexOf("1");
        const pairs = [...tokens].flatMap((value, i) => (i % 2 === 0 ? [[value, tokens[i + 1]] as const] : []));
        const numberToken = pairs.findLast(([start]) => start <= numberIndex);
        expect(numberToken).toBeDefined();
        expect(theme.colorMap[TokenMetadata.getForeground(numberToken?.[1] ?? 0)]).toBe("#B5CEA8");
    });

    it("вид токена — из метаданных: комментарий и строка", async () => {
        const loader = await createLoader();
        const support = await loader.loadSupport("source.js");
        if (!support) throw new Error("source.js not loaded");

        const comment = support.tokenizeEncoded("// hi", true, support.getInitialState()).tokens;
        expect(TokenMetadata.getTokenType(comment[comment.length - 1])).toBe(StandardTokenType.Comment);
        const string = support.tokenizeEncoded('"s"', true, support.getInitialState()).tokens;
        expect(TokenMetadata.getTokenType(string[1])).toBe(StandardTokenType.String);
    });

    it("endState между строками внутри блока комментария стабилизируется — тот же объект", async () => {
        const loader = await createLoader();
        const support = await loader.loadSupport("source.js");
        if (!support) throw new Error("source.js not loaded");

        const r1 = support.tokenizeEncoded("/* line1", true, support.getInitialState());
        const r2 = support.tokenizeEncoded("line2", true, r1.endState);
        const r3 = support.tokenizeEncoded("line3", true, r2.endState);

        expect(r1.endState.equals(r2.endState)).toBe(true);
        // The state did not change, so the object is reused (saves an allocation, as upstream).
        expect(r2.endState).toBe(r1.endState);
        expect(r3.endState).toBe(r1.endState);
    });

    it("сменившееся состояние — новый TextMateState", async () => {
        const loader = await createLoader();
        const support = await loader.loadSupport("source.js");
        if (!support) throw new Error("source.js not loaded");

        const initial = support.getInitialState();
        const r1 = support.tokenizeEncoded("/* open", true, initial);
        expect(r1.endState).not.toBe(initial);
        expect(r1.endState.equals(initial)).toBe(false);
    });

    it("на сверхдлинной строке — один токен цвета по умолчанию и тот же endState", async () => {
        const loader = await createLoader();
        const support = await loader.loadSupport("source.js");
        if (!support) throw new Error("source.js not loaded");

        const line = "x".repeat(20_001);
        const initial = support.getInitialState();
        const result = support.tokenizeEncoded(line, true, initial);

        expect(result.tokens.length).toBe(2);
        expect(result.tokens[0]).toBe(0);
        expect(TokenMetadata.getForeground(result.tokens[1])).toBe(ColorId.DefaultForeground);
        expect(result.endState).toBe(initial);
    });

    it("строка ровно на пределе длины токенизируется грамматикой", async () => {
        const loader = await createLoader();
        // With the theme `const` and `x…` differ in color, two tokens; without it they would merge into one.
        loader.setTheme(createTextMateTheme(darkModern()));
        const support = await loader.loadSupport("source.js");
        if (!support) throw new Error("source.js not loaded");

        const line = "const " + "x".repeat(20_000 - "const ".length);
        const tokens = support.tokenizeEncoded(line, true, support.getInitialState()).tokens;
        expect(tokens.length).toBeGreaterThan(2);
    });

    it("грамматика не уложилась во время — токены что успели и состояние начала строки", () => {
        const ruleStack = { equals: () => false, clone: () => ruleStack };
        let timeLimit: number | undefined;
        const grammar = {
            tokenizeLine2: (_line: string, _state: unknown, limit?: number) => {
                timeLimit = limit;
                return { tokens: new Uint32Array([0, 7]), ruleStack, stoppedEarly: true };
            },
        } as unknown as IGrammar;
        const support = new TextMateTokenizationSupport(grammar);
        const initial = support.getInitialState();

        const result = support.tokenizeEncoded("slow", true, initial);

        expect(timeLimit).toBe(500);
        expect([...result.tokens]).toEqual([0, 7]);
        expect(result.endState).toBe(initial);
    });

    it("бросает при несовместимом IState (не TextMateState)", async () => {
        const loader = await createLoader();
        const support = await loader.loadSupport("source.js");
        if (!support) throw new Error("source.js not loaded");

        expect(() => support.tokenizeEncoded("const x = 1;", true, NULL_STATE)).toThrow(/incompatible IState/);
    });

    it("loader.loadSupport для неизвестного scope возвращает null", async () => {
        const loader = await createLoader();
        const support = await loader.loadSupport("source.unknown");
        expect(support).toBeNull();
    });

    it("все builtin-грамматики с language грузятся успешно", async () => {
        const loader = await createLoader();
        const extensions = await extensionsPromise;
        for (const ext of extensions) {
            const grammars = ext.manifest.contributes?.grammars ?? [];
            for (const grammar of grammars) {
                if (grammar.language === undefined) continue;
                const support = await loader.loadSupport(grammar.scopeName);
                expect(support, `${grammar.language} (${grammar.scopeName}) must load`).not.toBeNull();
            }
        }
    });
});
