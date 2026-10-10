import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { isCancellationError } from "../../../../base/common/errorSerialization.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import type { ISemanticTokensRequest } from "../../../../editor/common/languages/iSemanticTokensSource.ts";

/** Язык-сервис, размечающий всё как csharp (селектор фикстуры совпадёт). */
const CSHARP_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "csharp",
    getLanguageDisplayName: () => "C#",
    getExtensionForLanguage: () => ".cs",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const TEXT = ["class Foo", "var bar"].join("\n");

/**
 * Разметка фикстуры для {@link TEXT}: «class» (variable+declaration), «Foo»
 * (class), «var» (variable+declaration), «bar» (variable).
 */
const TOKENS = [0, 0, 5, 1, 1, 0, 6, 3, 0, 0, 1, 0, 3, 1, 1, 0, 4, 3, 1, 0];

function requestIn(harness: IExtensionHarness): ISemanticTokensRequest {
    const uri = Uri.file(`${harness.tmpDir}/Program.cs`).toString();
    return { uri, languageId: "csharp", versionId: documentVersion(harness, uri) };
}

function target(request: ISemanticTokensRequest) {
    return { uri: Uri.parse(request.uri), languageId: request.languageId };
}

async function withHarness(run: (harness: IExtensionHarness) => Promise<void>): Promise<void> {
    const harness = await createExtensionTestHarness({
        initialFile: { name: "Program.cs", content: TEXT },
        languageService: CSHARP_LANGUAGE_SERVICE,
        extensions: [extensionFixture("test.providesSemanticTokens", "providesSemanticTokens.cjs")],
    });
    try {
        await settle();
        await run(harness);
    } finally {
        await harness.dispose();
    }
}

describe("ExtensionHost — семантические токены (subprocess)", () => {
    it("документ: полный ответ с легендой, повтор с resultId — пустая дельта", async () => {
        await withHarness(async (harness) => {
            const request = requestIn(harness);
            const [provider] = harness.languageFeatures.documentSemanticTokensProvider.ordered(target(request));
            expect(provider.getLegend()).toEqual({
                tokenTypes: ["class", "variable"],
                tokenModifiers: ["declaration"],
            });

            const first = await provider.provideDocumentSemanticTokens(request, null, CancellationTokenNone);
            expect(first).toEqual({ resultId: "1", data: new Uint32Array(TOKENS) });

            const second = await provider.provideDocumentSemanticTokens(
                request,
                first?.resultId ?? null,
                CancellationTokenNone,
            );
            expect(second).toEqual({ resultId: "2", edits: [] });
        });
    });

    it("устаревший запрос доходит до ядра отменой, а не пустым ответом (null стёр бы подсветку)", async () => {
        await withHarness(async (harness) => {
            const request = requestIn(harness);
            const [provider] = harness.languageFeatures.documentSemanticTokensProvider.ordered(target(request));
            const stale = { ...request, versionId: request.versionId - 1 };
            await expect(provider.provideDocumentSemanticTokens(stale, null, CancellationTokenNone)).rejects.toSatisfy(
                isCancellationError,
            );
        });
    });

    it("onDidChangeSemanticTokens расширения доезжает до прокси в реестре ядра", async () => {
        await withHarness(async (harness) => {
            const request = requestIn(harness);
            const [provider] = harness.languageFeatures.documentSemanticTokensProvider.ordered(target(request));
            let changes = 0;
            provider.onDidChange?.(() => {
                changes++;
            });
            // Фикстура фаерит событие вскоре после первого ответа.
            await provider.provideDocumentSemanticTokens(request, null, CancellationTokenNone);
            const deadline = Date.now() + 5000;
            while (changes === 0 && Date.now() < deadline) await settle();
            expect(changes).toBe(1);
        });
    });

    it("диапазон: токены только строк диапазона", async () => {
        await withHarness(async (harness) => {
            const request = requestIn(harness);
            const [provider] = harness.languageFeatures.documentRangeSemanticTokensProvider.ordered(target(request));
            const result = await provider.provideDocumentRangeSemanticTokens(
                { ...request, range: createRange(1, 0, 1, 7) },
                CancellationTokenNone,
            );
            expect(result).toEqual({ resultId: "0", data: new Uint32Array([1, 0, 3, 1, 1, 0, 4, 3, 1, 0]) });
        });
    });
});
