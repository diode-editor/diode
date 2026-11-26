import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";

// The whole path of `registerInlineValuesProvider`: an extension in the subprocess → the core's registry → a request
// with the view port and the frame's context → the extension's three kinds back in the core.

const C_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "c",
    getLanguageDisplayName: () => "C",
    getRegisteredLanguageIds: () => [],
    getExtensionForLanguage: () => ".c",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

describe("ExtensionHost — inline values providers (subprocess)", () => {
    it("the extension's provider is in the core's registry and answers the core's request", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.c", content: "int main() {\n    int sum = 0;\n}\n" },
            languageService: C_LANGUAGE_SERVICE,
            extensions: [extensionFixture("test.providesInlineValues", "providesInlineValues.cjs")],
        });
        try {
            const editor = harness.group.getActiveEditor();
            if (editor === null) throw new Error("no active editor");
            const registry = harness.languageFeatures.inlineValuesProvider;
            await waitUntil("the extension's provider", () => registry.has(editor));
            const [provider] = registry.ordered(editor);
            const range = createRange(1, 4, 1, 7);
            const values = await provider.provideInlineValues(
                {
                    uri: editor.uri.toString(),
                    languageId: "c",
                    versionId: editor.versionId,
                    viewPort: createRange(0, 0, 2, 1),
                    context: { frameId: 7, stoppedLocation: createRange(1, 4, 1, 4) },
                },
                CancellationTokenNone,
            );
            expect(values).toEqual([
                { type: "text", range, text: "frame 7 of 3 lines" },
                { type: "variable", range, variableName: "sum", caseSensitiveLookup: true },
                { type: "expression", range, expression: "sum * 2" },
            ]);
        } finally {
            await harness.dispose();
        }
    });
});
