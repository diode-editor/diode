import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    type IExtensionHarness,
    provideFoldingRegions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IFoldingRequest } from "../../../../editor/common/languages/iFoldingSource.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";

const CSHARP_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "csharp",
    getLanguageDisplayName: () => "C#",
    getExtensionForLanguage: () => ".cs",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const CSHARP_TEXT = ["/* #region A */", "int a;", "int b;", "/* #endregion */", "int c;"].join("\n");

function requestIn(harness: IExtensionHarness): IFoldingRequest {
    const uri = Uri.file(`${harness.tmpDir}/Program.cs`).toString();
    return { uri, languageId: "csharp", versionId: documentVersion(harness, uri) };
}

describe("ExtensionHost — folding bridge (subprocess)", () => {
    it("provideFoldingRanges returns the provider's regions", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "Program.cs", content: CSHARP_TEXT },
            languageService: CSHARP_LANGUAGE_SERVICE,
            extensions: [extensionFixture("test.providesFolding", "providesFolding.cjs")],
        });
        try {
            await settle();
            const regions = await provideFoldingRegions(harness, requestIn(harness));
            expect(regions).toEqual([{ startLine: 0, endLine: 3, isCollapsed: false }]);
        } finally {
            await harness.dispose();
        }
    });

    it("a selector for another language → empty result", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "Program.cs", content: CSHARP_TEXT },
            languageService: CSHARP_LANGUAGE_SERVICE,
            extensions: [extensionFixture("test.providesFolding", "providesFolding.cjs")],
        });
        try {
            await settle();
            const regions = await provideFoldingRegions(harness, { ...requestIn(harness), languageId: "typescript" });
            expect(regions).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("no folding providers (no extensions) → [] without RPC", async () => {
        const harness = await createExtensionTestHarness({});
        try {
            const regions = await provideFoldingRegions(harness, {
                uri: Uri.file("/proj/Program.cs").toString(),
                languageId: "csharp",
                versionId: 1,
            });
            expect(regions).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("late activation: folds arrive in an already open editor", async () => {
        // Like main.ts on onStartupFinished: the file is open BEFORE the extension activates.
        const harness = await createExtensionTestHarness({
            initialFile: { name: "Program.cs", content: CSHARP_TEXT },
            languageService: CSHARP_LANGUAGE_SERVICE,
            extensions: [extensionFixture("test.providesFolding", "providesFolding.cjs")],
        });
        try {
            await harness.flushRpc(6);
            await settle();
            await harness.flushRpc(6);
            const regions = harness.group.getActiveEditor()?.viewState.foldedRegions ?? [];
            expect(regions.some((r) => r.startLine === 0 && r.endLine === 3)).toBe(true);
        } finally {
            await harness.dispose();
        }
    });
});
