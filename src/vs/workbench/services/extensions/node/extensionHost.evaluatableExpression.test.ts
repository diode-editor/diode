import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { createPosition } from "../../../../editor/common/core/iPosition.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { getEvaluatableExpressionAtPosition } from "../../../contrib/debug/common/debugUtils.ts";

// The whole path of `registerEvaluatableExpressionProvider`: an extension in the subprocess → the core's registry →
// the expression the debug hover evaluates.

const TS_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "typescript",
    getLanguageDisplayName: () => "TypeScript",
    getRegisteredLanguageIds: () => [],
    getExtensionForLanguage: () => ".ts",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const FIXTURE = extensionFixture("test.providesEvaluatableExpression", "providesEvaluatableExpression.cjs");

describe("ExtensionHost — evaluatable expression providers (subprocess)", () => {
    it("the extension's expression for the word under the cursor; nothing where it has none", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "total = nums.length;\nother\n" },
            languageService: TS_LANGUAGE_SERVICE,
            extensions: [FIXTURE],
        });
        try {
            const editor = harness.group.getActiveEditor();
            if (editor === null) throw new Error("no active editor");
            const providers = harness.languageFeatures.evaluatableExpressionProvider;
            await waitUntil("the provider", () => providers.has(editor));
            const { document } = editor.viewState;
            const model = {
                uri: editor.uri,
                languageId: editor.languageId,
                versionId: document.versionId,
                getLineContent: (line: number) => document.getLineContent(line),
            };
            const at = (line: number, character: number) =>
                getEvaluatableExpressionAtPosition(
                    providers,
                    model,
                    createPosition(line, character),
                    CancellationTokenNone,
                );

            expect(await at(0, 10)).toEqual({ matchingExpression: "this.nums", range: createRange(0, 8, 0, 12) });
            expect(await at(1, 1)).toBeNull();
        } finally {
            await harness.dispose();
        }
    });
});
