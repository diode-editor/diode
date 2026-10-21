import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    provideReferences,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import type { IReferenceRequest } from "../../../../editor/common/languages/iReferenceSource.ts";

const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

const TEXT = "const answer = compute();\nconst other = 1;\n";

/** Version for requests on a document without an open editor: the answer is empty for any version. */
const UNOPENED_VERSION = 1;

function requestFor(uri: string, line: number, versionId: number, includeDeclaration = true): IReferenceRequest {
    return { uri, languageId: "typescript", versionId, line, character: 6, includeDeclaration };
}

describe("ExtensionHost — reference providers (subprocess)", () => {
    it("two real providers: references arrive concatenated, on equal score the newer comes first", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: TEXT },
            extensions: [extensionFixture("test.providesReferences", "providesReferences.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            const mainUri = Uri.file(`${harness.tmpDir}/main.ts`).toString();
            const otherUri = mainUri.replace("main.ts", "other.ts");

            // Line 0 → both answer. Equal score: the later registration
            // comes first, as in vscode.
            expect(await provideReferences(harness, requestFor(mainUri, 0, documentVersion(harness, mainUri)))).toEqual(
                [
                    { uri: otherUri, range: createRange(7, 2, 7, 8) },
                    { uri: mainUri, range: createRange(0, 0, 0, 5) },
                    { uri: mainUri, range: createRange(0, 6, 0, 12) },
                ],
            );

            expect(
                await provideReferences(harness, requestFor(mainUri, 0, documentVersion(harness, mainUri), false)),
            ).toEqual([
                { uri: otherUri, range: createRange(7, 2, 7, 8) },
                { uri: mainUri, range: createRange(0, 6, 0, 12) },
            ]);

            // Line 1 → both stay silent: an empty answer, not garbage.
            expect(await provideReferences(harness, requestFor(mainUri, 1, documentVersion(harness, mainUri)))).toEqual(
                [],
            );
        } finally {
            await harness.dispose();
        }
    });

    it("without a subprocess and without providers the references registry is empty", async () => {
        // The extension is registered but not activated, so the subprocess is not started.
        const lazy = await createExtensionTestHarness({
            extensions: [extensionFixture("test.providesReferences", "providesReferences.cjs")],
            activateEvents: [],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await provideReferences(lazy, requestFor("file:///a.ts", 0, UNOPENED_VERSION))).toEqual([]);
        } finally {
            await lazy.dispose();
        }

        // The subprocess is up (noop is active), but no one registered references providers.
        const noProviders = await createExtensionTestHarness({
            extensions: [extensionFixture("test.noop", "noopExtension.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await provideReferences(noProviders, requestFor("file:///a.ts", 0, UNOPENED_VERSION))).toEqual([]);
        } finally {
            await noProviders.dispose();
        }
    });
});
