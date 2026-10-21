import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    CLIENT_CRASH_PATTERNS,
    type IInstalledBasedpyright,
    installBasedpyright,
    PY_LANGUAGE_SERVICE,
    until,
} from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    provideCompletions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ICoreCompletionItem } from "../../../../editor/common/languages/iCompletionSource.ts";
import { CompletionTriggerKind } from "../../../../editor/common/languages/iCompletionSource.ts";

// `new code.CompletionList(...)` and resolve run foreign code, so only an end-to-end run checks them.

const MAIN_PY = 'text = "hi"\ntext.\n';

let installed: IInstalledBasedpyright;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — completion from the stock basedpyright", () => {
    beforeAll(async () => {
        installed = await installBasedpyright();
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it("str members after a dot reach the core, resolve returns documentation", { timeout: 240_000 }, async () => {
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
            const mainPath = harness.writeFile("main.py", MAIN_PY);
            const mainUri = Uri.file(mainPath).toString();

            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:python");

            const completionAt = async (line: number, character: number): Promise<readonly ICoreCompletionItem[]> => {
                const result = await provideCompletions(harness, {
                    uri: mainUri,
                    languageId: "python",
                    versionId: documentVersion(harness, mainUri),
                    line,
                    character,
                    triggerKind: CompletionTriggerKind.TriggerCharacter,
                    triggerCharacter: ".",
                });
                return result.items;
            };

            // Cursor right after `text.`: expect str members from the typeshed stubs.
            const items = await until("completion after `text.`", async () => {
                const found = await completionAt(1, 5);
                return found.length > 0 ? found : null;
            });

            const labels = items.map((item) => item.label);
            expect(labels).toContain("upper");
            expect(labels).toContain("startswith");

            // Documentation arrives only on resolve (the resolveSupport contract).
            const upper = items.find((item) => item.label === "upper");
            expect(upper?.id).toBeDefined();
            const resolved = await until("resolve of the upper item", async () => {
                const found = await harness.host.resolveCompletionItem(upper!.id!);
                return found?.detail !== undefined || found?.documentation !== undefined ? found : null;
            });
            // Text that is not in the buffer: the signature/docstring of str.upper from the stubs.
            expect(`${resolved.detail ?? ""}\n${resolved.documentation ?? ""}`).toContain("upper");

            const crashes = outputLines.filter((line) => CLIENT_CRASH_PATTERNS.test(line.value));
            expect(crashes).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
