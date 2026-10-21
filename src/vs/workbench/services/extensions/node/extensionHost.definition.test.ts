import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    provideDefinitions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { IDefinitionRequest } from "../../../../editor/common/languages/iDefinitionSource.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";

const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

/** The response is empty for any version. */
const UNOPENED_VERSION = 1;

function requestFor(uri: string, line: number, versionId: number): IDefinitionRequest {
    return { uri, languageId: "typescript", versionId, line, character: 6 };
}

describe("ExtensionHost — definition providers (subprocess)", () => {
    it("a real provider: Location and LocationLink arrive as core targets", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "const answer = compute();\nconst other = 1;\n" },
            extensions: [extensionFixture("test.providesDefinition", "providesDefinition.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            const mainUri = Uri.file(`${harness.tmpDir}/main.ts`).toString();
            const defsUri = Uri.file(`${harness.tmpDir}/defs.ts`).toString();

            // Line 0 → the fixture returns a single vscode.Location.
            const fromLocation = await provideDefinitions(
                harness,
                requestFor(mainUri, 0, documentVersion(harness, mainUri)),
            );
            expect(fromLocation).toEqual([{ uri: defsUri, range: createRange(2, 4, 2, 9) }]);

            // Line 1 → an array of LocationLink.
            const fromLink = await provideDefinitions(
                harness,
                requestFor(mainUri, 1, documentVersion(harness, mainUri)),
            );
            expect(fromLink).toEqual([{ uri: defsUri, range: createRange(5, 9, 5, 14) }]);
        } finally {
            await harness.dispose();
        }
    });

    it("without a subprocess and providers the definition registry is empty", async () => {
        const lazy = await createExtensionTestHarness({
            extensions: [extensionFixture("test.providesDefinition", "providesDefinition.cjs")],
            activateEvents: [],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await provideDefinitions(lazy, requestFor("file:///a.ts", 0, UNOPENED_VERSION))).toEqual([]);
        } finally {
            await lazy.dispose();
        }

        const noProviders = await createExtensionTestHarness({
            extensions: [extensionFixture("test.noop", "noopExtension.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await provideDefinitions(noProviders, requestFor("file:///a.ts", 0, UNOPENED_VERSION))).toEqual([]);
        } finally {
            await noProviders.dispose();
        }
    });
});
