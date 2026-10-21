import * as fs from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PY_LANGUAGE_SERVICE, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    formatDocumentFor,
    type IExtensionHarness,
    provideCodeActions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { type IInstalledRuff, installRuff, LINT_PY } from "../../../../../TestUtils/ruffFixture.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";

// #196: the hermetic onSave contract is editorService.onSave.test.ts; here we check
// that the stock extension satisfies it.

let installed: IInstalledRuff;

function stubConfigurationService(values: Record<string, unknown>): IConfigurationService {
    return createTestConfigurationService(values);
}

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — saving with onSave settings and the stock ruff", () => {
    beforeAll(async () => {
        installed = await installRuff();
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    async function openLintFile(configuration: Record<string, unknown>): Promise<{
        harness: IExtensionHarness;
        lintPath: string;
        lintUri: string;
    }> {
        const harness = await createExtensionTestHarness({
            languageService: PY_LANGUAGE_SERVICE,
            activateEvents: [],
            extensions: [installed.registration],
            configurationService: stubConfigurationService(configuration),
        });
        const lintPath = harness.writeFile("lint.py", LINT_PY);
        harness.group.openFile(lintPath);
        await harness.host.activateByEvent("onLanguage:python");
        return { harness, lintPath, lintUri: Uri.file(lintPath).toString() };
    }

    it(
        "codeActionsOnSave source.fixAll: save removes the unused import in the buffer and on disk",
        { timeout: 240_000 },
        async () => {
            const { harness, lintPath, lintUri } = await openLintFile({
                "editor.codeActionsOnSave": { "source.fixAll": true },
            });
            try {
                // Warm-up: wait until the server starts returning fixAll actions,
                // otherwise the first save hits the cold start and its 5s timeouts.
                await until("source.fixAll action from ruff", async () => {
                    const actions = await provideCodeActions(harness, {
                        uri: lintUri,
                        languageId: "python",
                        versionId: documentVersion(harness, lintUri),
                        range: createRange(0, 0, 4, 17),
                        only: "source.fixAll",
                    });
                    return actions.length > 0 ? actions : null;
                });

                const outcome = await harness.group.getActiveEditor()!.save();

                expect(outcome).toBe("saved");
                const buffer = harness.group.getActiveEditor()?.getText() ?? "";
                expect(buffer).not.toContain("import sys");
                expect(buffer).toContain("import os");
                expect(fs.readFileSync(lintPath, "utf-8")).toBe(buffer);
            } finally {
                await harness.dispose();
            }
        },
    );

    it("formatOnSave: save runs the ruff formatter, the text on disk is formatted", { timeout: 240_000 }, async () => {
        const { harness, lintPath, lintUri } = await openLintFile({ "editor.formatOnSave": true });
        try {
            // Warm-up: the client registers formatting dynamically, so wait for edits.
            await until("formatting edits from ruff", async () => {
                const found: readonly ITextEdit[] | null = await formatDocumentFor(harness, {
                    uri: lintUri,
                    languageId: "python",
                    versionId: documentVersion(harness, lintUri),
                    tabSize: 4,
                    insertSpaces: true,
                });
                return found !== null && found.length > 0 ? found : null;
            });

            const outcome = await harness.group.getActiveEditor()!.save();

            expect(outcome).toBe("saved");
            const buffer = harness.group.getActiveEditor()?.getText() ?? "";
            expect(buffer).toContain('print("x")');
            expect(fs.readFileSync(lintPath, "utf-8")).toBe(buffer);
        } finally {
            await harness.dispose();
        }
    });
});
