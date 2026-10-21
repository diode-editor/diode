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

/** A language service that marks everything as csharp (the fixture's selector matches). */
const CSHARP_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "csharp",
    getLanguageDisplayName: () => "C#",
    getExtensionForLanguage: () => ".cs",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const TEXT = ["class Foo", "var bar"].join("\n");

/**
 * The fixture's tokens for {@link TEXT}: "class" (variable+declaration), "Foo"
 * (class), "var" (variable+declaration), "bar" (variable).
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

describe("ExtensionHost — semantic tokens (subprocess)", () => {
    it("document: a full response with a legend, a repeat with resultId yields an empty delta", async () => {
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

    it("response release reaches the extension: a repeat with its resultId is full again", async () => {
        await withHarness(async (harness) => {
            const request = requestIn(harness);
            const [provider] = harness.languageFeatures.documentSemanticTokensProvider.ordered(target(request));
            const first = await provider.provideDocumentSemanticTokens(request, null, CancellationTokenNone);
            provider.releaseDocumentSemanticTokens(first?.resultId);
            const second = await provider.provideDocumentSemanticTokens(
                request,
                first?.resultId ?? null,
                CancellationTokenNone,
            );
            expect(second).toEqual({ resultId: "2", data: new Uint32Array(TOKENS) });
        });
    });

    it("a stale request reaches the core as a cancellation, not an empty response (null would erase highlighting)", async () => {
        await withHarness(async (harness) => {
            const request = requestIn(harness);
            const [provider] = harness.languageFeatures.documentSemanticTokensProvider.ordered(target(request));
            const stale = { ...request, versionId: request.versionId - 1 };
            await expect(provider.provideDocumentSemanticTokens(stale, null, CancellationTokenNone)).rejects.toSatisfy(
                isCancellationError,
            );
        });
    });

    it("the extension's onDidChangeSemanticTokens reaches the proxy in the core registry", async () => {
        await withHarness(async (harness) => {
            const request = requestIn(harness);
            const [provider] = harness.languageFeatures.documentSemanticTokensProvider.ordered(target(request));
            let changes = 0;
            provider.onDidChange?.(() => {
                changes++;
            });
            // The fixture fires the event shortly after the first response.
            await provider.provideDocumentSemanticTokens(request, null, CancellationTokenNone);
            const deadline = Date.now() + 5000;
            while (changes === 0 && Date.now() < deadline) await settle();
            expect(changes).toBe(1);
        });
    });

    it("range: tokens only for the lines in range", async () => {
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
