import { describe, expect, it, vi } from "vitest";

import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../common/core/iRange.ts";
import { type ILanguageFeatureTarget, LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import type {
    DocumentRangeSemanticTokensProvider,
    DocumentSemanticTokensProvider,
    ISemanticTokens,
    ISemanticTokensEdits,
} from "../../../common/languages/iSemanticTokensSource.ts";

import { getDocumentRangeSemanticTokens, getDocumentSemanticTokens } from "./getSemanticTokens.ts";

const TARGET: ILanguageFeatureTarget = { uri: Uri.file("/w/A.java"), languageId: "java" };
const REQUEST = { uri: TARGET.uri.toString(), languageId: "java", versionId: 3 };
const LEGEND = { tokenTypes: ["a"], tokenModifiers: [] };

function tokens(resultId: string): ISemanticTokens {
    return { resultId, data: new Uint32Array([0, 0, 1, 0, 0]) };
}

function docProvider(
    answer: () => Promise<ISemanticTokens | ISemanticTokensEdits | null>,
): DocumentSemanticTokensProvider & { provideDocumentSemanticTokens: ReturnType<typeof vi.fn> } {
    return {
        getLegend: () => LEGEND,
        provideDocumentSemanticTokens: vi.fn(answer),
        releaseDocumentSemanticTokens: () => undefined,
    };
}

function rangeProvider(answer: () => Promise<ISemanticTokens | null>): DocumentRangeSemanticTokensProvider {
    return { getLegend: () => LEGEND, provideDocumentRangeSemanticTokens: vi.fn(answer) };
}

describe("getDocumentSemanticTokens", () => {
    it("no providers yields null", async () => {
        const registry = new LanguageFeatureRegistry<DocumentSemanticTokensProvider>();
        expect(await getDocumentSemanticTokens(registry, TARGET, REQUEST, null, null, CancellationTokenNone)).toBe(
            null,
        );
    });

    it("only the top group is asked; request and token are passed as is", async () => {
        const registry = new LanguageFeatureRegistry<DocumentSemanticTokensProvider>();
        const generic = docProvider(() => Promise.resolve(tokens("g")));
        const exact = docProvider(() => Promise.resolve(tokens("e")));
        registry.register("*", generic);
        registry.register("java", exact);
        const result = await getDocumentSemanticTokens(registry, TARGET, REQUEST, null, null, CancellationTokenNone);
        expect(result?.provider).toBe(exact);
        expect(result?.tokens).toEqual(tokens("e"));
        expect(generic.provideDocumentSemanticTokens).not.toHaveBeenCalled();
        expect(exact.provideDocumentSemanticTokens).toHaveBeenCalledWith(REQUEST, null, CancellationTokenNone);
    });

    it("only the provider of the previous result receives lastResultId", async () => {
        const registry = new LanguageFeatureRegistry<DocumentSemanticTokensProvider>();
        const a = docProvider(() => Promise.resolve(null));
        const b = docProvider(() => Promise.resolve(null));
        registry.register("java", a);
        registry.register("java", b);
        await getDocumentSemanticTokens(registry, TARGET, REQUEST, a, "7", CancellationTokenNone);
        expect(a.provideDocumentSemanticTokens).toHaveBeenCalledWith(REQUEST, "7", CancellationTokenNone);
        expect(b.provideDocumentSemanticTokens).toHaveBeenCalledWith(REQUEST, null, CancellationTokenNone);
    });

    it("first result with tokens wins; all empty yields the first empty result", async () => {
        const registry = new LanguageFeatureRegistry<DocumentSemanticTokensProvider>();
        const older = docProvider(() => Promise.resolve(tokens("old")));
        const newer = docProvider(() => Promise.resolve(null));
        registry.register("java", older);
        registry.register("java", newer);
        const withTokens = await getDocumentSemanticTokens(
            registry,
            TARGET,
            REQUEST,
            null,
            null,
            CancellationTokenNone,
        );
        expect(withTokens).toEqual({ provider: older, tokens: tokens("old") });

        const empty = new LanguageFeatureRegistry<DocumentSemanticTokensProvider>();
        const first = docProvider(() => Promise.resolve(null));
        empty.register(
            "java",
            docProvider(() => Promise.resolve(null)),
        );
        empty.register("java", first);
        expect(await getDocumentSemanticTokens(empty, TARGET, REQUEST, null, null, CancellationTokenNone)).toEqual({
            provider: first,
            tokens: null,
        });
    });

    it("provider error before a result with tokens throws", async () => {
        const registry = new LanguageFeatureRegistry<DocumentSemanticTokensProvider>();
        registry.register(
            "java",
            docProvider(() => Promise.resolve(tokens("ok"))),
        );
        registry.register(
            "java",
            docProvider(() => Promise.reject(new Error("boom"))),
        );
        await expect(
            getDocumentSemanticTokens(registry, TARGET, REQUEST, null, null, CancellationTokenNone),
        ).rejects.toThrow("boom");
    });

    it("rejection without a reason throws too", async () => {
        const registry = new LanguageFeatureRegistry<DocumentSemanticTokensProvider>();
        // An extension provider may reject with anything, not only an Error.
        const rejectWithoutReason = (): Promise<null> => Promise.reject(undefined as unknown as Error);
        registry.register("java", docProvider(rejectWithoutReason));
        await expect(
            getDocumentSemanticTokens(registry, TARGET, REQUEST, null, null, CancellationTokenNone),
        ).rejects.toThrow(new Error("undefined"));
    });
});

describe("getDocumentRangeSemanticTokens", () => {
    const RANGE_REQUEST = { ...REQUEST, range: createRange(0, 0, 4, 0) };

    it("no providers yields null", async () => {
        const registry = new LanguageFeatureRegistry<DocumentRangeSemanticTokensProvider>();
        expect(await getDocumentRangeSemanticTokens(registry, TARGET, RANGE_REQUEST, CancellationTokenNone)).toBe(null);
    });

    it("error means no tokens, a sibling result with tokens wins", async () => {
        const registry = new LanguageFeatureRegistry<DocumentRangeSemanticTokensProvider>();
        const good = rangeProvider(() => Promise.resolve(tokens("r")));
        registry.register("java", good);
        registry.register(
            "java",
            rangeProvider(() => Promise.reject(new Error("boom"))),
        );
        expect(await getDocumentRangeSemanticTokens(registry, TARGET, RANGE_REQUEST, CancellationTokenNone)).toEqual({
            provider: good,
            tokens: tokens("r"),
        });
        expect(good.provideDocumentRangeSemanticTokens).toHaveBeenCalledWith(RANGE_REQUEST, CancellationTokenNone);
    });

    it("all without tokens yields the first provider with null; only the top group is asked", async () => {
        const registry = new LanguageFeatureRegistry<DocumentRangeSemanticTokensProvider>();
        const generic = rangeProvider(() => Promise.resolve(tokens("g")));
        const failing = rangeProvider(() => Promise.reject(new Error("boom")));
        registry.register("*", generic);
        registry.register("java", failing);
        expect(await getDocumentRangeSemanticTokens(registry, TARGET, RANGE_REQUEST, CancellationTokenNone)).toEqual({
            provider: failing,
            tokens: null,
        });
        expect(generic.provideDocumentRangeSemanticTokens).not.toHaveBeenCalled();
    });
});
