import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    CLIENT_CRASH_PATTERNS,
    DEFS_PY,
    type IInstalledBasedpyright,
    installBasedpyright,
    MAIN_PY,
    PY_LANGUAGE_SERVICE,
    until,
} from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    provideReferences,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { Uri } from "../../../../base/common/uri.ts";

let installed: IInstalledBasedpyright;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — references from the stock basedpyright", () => {
    beforeAll(async () => {
        installed = await installBasedpyright();
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it("references to greet come from both files (including the declaration)", { timeout: 240_000 }, async () => {
        const outputLines: { level: string; value: string }[] = [];
        const harness: IExtensionHarness = await createExtensionTestHarness({
            languageService: PY_LANGUAGE_SERVICE,
            activateEvents: [],
            outputSink: {
                append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                show: () => undefined,
            },
            extensions: [installed.registration],
        });
        try {
            const defsPath = harness.writeFile("defs.py", DEFS_PY);
            const mainPath = harness.writeFile("main.py", MAIN_PY);
            const mainUri = Uri.file(mainPath).toString();
            const defsUri = Uri.file(defsPath).toString();

            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:python");

            // Cursor on the `greet` call → references with includeDeclaration (like VS Code).
            const references = await until("references of the greet call", async () => {
                const found = await provideReferences(harness, {
                    uri: mainUri,
                    languageId: "python",
                    versionId: documentVersion(harness, mainUri),
                    line: 2,
                    character: 15,
                    includeDeclaration: true,
                });
                // Wait until the server has indexed BOTH files (the current one may arrive alone first).
                const uris = new Set(found.map((ref) => ref.uri));
                return uris.has(defsUri) && uris.has(mainUri) ? found : null;
            });

            // The declaration in defs.py: the name `greet` at column 4 of the first line.
            const declaration = references.find((ref) => ref.uri === defsUri);
            expect(declaration?.range.start).toMatchObject({ line: 0, character: 4 });
            const inMain = references.filter((ref) => ref.uri === mainUri);
            expect(inMain.length).toBeGreaterThanOrEqual(2);

            const crashes = outputLines.filter((line) => CLIENT_CRASH_PATTERNS.test(line.value));
            expect(crashes).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
