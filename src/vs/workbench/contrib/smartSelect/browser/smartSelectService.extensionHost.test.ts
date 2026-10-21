import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { selectionToRange } from "../../../../editor/common/core/iSelection.ts";
import { NULL_LANGUAGE_CONFIGURATION_SERVICE } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";

import { SmartSelectService } from "./smartSelectService.ts";

const FIXTURE = extensionFixture("test.providesSelectionRanges", "providesSelectionRanges.cjs");
const CONTENT = "alpha beta\ngamma\nlast\n";

describe("ExtensionHost — selection range providers (subprocess)", () => {
    it("the provider step sits between the built-in ones; shrink returns to the cursor", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.txt", content: CONTENT },
            extensions: [FIXTURE],
        });
        try {
            await settle();
            const editor = harness.group.getActiveEditor();
            if (editor === null) throw new Error("no active editor");
            editor.goToPosition(0, 7);
            const service = new SmartSelectService(
                harness.group,
                harness.languageFeatures,
                NULL_LANGUAGE_CONFIGURATION_SERVICE,
                new InMemoryConfigurationService(),
            );
            const selected = (): string =>
                editor.viewState.document.getTextInRange(selectionToRange(editor.viewState.selections[0]));

            const expanded: string[] = [];
            for (let i = 0; i < 4; i++) {
                await service.run(true);
                expanded.push(selected());
            }
            expect(expanded).toEqual(["beta", "alpha beta", "alpha beta\ngamma", CONTENT]);

            for (let i = 0; i < 4; i++) await service.run(false);
            expect(selected()).toBe("");
            expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 7 });
        } finally {
            await harness.dispose();
        }
    });
});
