import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    provideHovers,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { IHoverRequest } from "../../../../editor/common/languages/iHoverSource.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";

const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

/** Version for requests on a document without an open editor: the response is empty for any version. */
const UNOPENED_VERSION = 1;

function requestFor(uri: string, line: number, versionId: number): IHoverRequest {
    return { uri, languageId: "typescript", versionId, line, character: 6 };
}

describe("ExtensionHost — hover providers (subprocess)", () => {
    it("two real providers: hovers arrive concatenated, with equal score the newer one first", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "const answer = compute();\nconst other = 1;\n" },
            extensions: [extensionFixture("test.providesHover", "providesHover.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            const mainUri = Uri.file(`${harness.tmpDir}/main.ts`).toString();
            const target = { uri: Uri.parse(mainUri), languageId: "typescript" };
            expect(harness.languageFeatures.hoverProvider.ordered(target)).toHaveLength(2);
            expect(harness.languageFeatures.hoverProvider.has({ ...target, languageId: "markdown" })).toBe(false);

            // Line 0 → both answer. With equal scores the later registered one
            // comes first, as in vscode.
            const hovers = await provideHovers(harness, requestFor(mainUri, 0, documentVersion(harness, mainUri)));
            expect(hovers).toEqual([
                { contents: ["```ts\ncompute(): number\n```"] },
                { contents: ["```ts\nconst answer: number\n```"], range: createRange(0, 6, 0, 12) },
            ]);

            // Line 1 → both stay silent: an empty response, not garbage.
            expect(await provideHovers(harness, requestFor(mainUri, 1, documentVersion(harness, mainUri)))).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("without a subprocess and providers the hover registry is empty", async () => {
        // The extension is registered but not activated, so the subprocess is not started.
        const lazy = await createExtensionTestHarness({
            extensions: [extensionFixture("test.providesHover", "providesHover.cjs")],
            activateEvents: [],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await provideHovers(lazy, requestFor("file:///a.ts", 0, UNOPENED_VERSION))).toEqual([]);
        } finally {
            await lazy.dispose();
        }

        // The subprocess is up (noop is active), but nobody registered hover providers.
        const noProviders = await createExtensionTestHarness({
            extensions: [extensionFixture("test.noop", "noopExtension.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await provideHovers(noProviders, requestFor("file:///a.ts", 0, UNOPENED_VERSION))).toEqual([]);
        } finally {
            await noProviders.dispose();
        }
    });
});
