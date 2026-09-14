import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { InlineCompletionTriggerKind } from "../../../../editor/common/languages/iInlineCompletionSource.ts";

const REQ = {
    uri: Uri.file("/proj/main.ts").toString(),
    languageId: "typescript",
    text: "function fib",
    line: 0,
    character: 12,
    triggerKind: InlineCompletionTriggerKind.Automatic,
};

describe("ExtensionHost — inline completion bridge (subprocess)", () => {
    it("provideInlineCompletions возвращает пункты провайдера: plain-текст и сниппет со стрипом", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "function fib" },
            extensions: [extensionFixture("test.providesInlineCompletion", "providesInlineCompletion.cjs")],
        });
        try {
            await settle();

            // Через group.inlineCompletionSource (wiring харнесса) — как это делает ядро.
            const items = await harness.group.inlineCompletionSource!(REQ);
            expect(items).toEqual([
                { insertText: "(n) {\n    return n;\n}" },
                {
                    insertText: "fibonacci(n)",
                    filterText: "fibonacci",
                    range: { start: { line: 0, character: 9 }, end: { line: 0, character: 12 } },
                },
            ]);
        } finally {
            await harness.dispose();
        }
    });

    it("селектор другого языка → пустой результат", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "function fib" },
            extensions: [extensionFixture("test.providesInlineCompletion", "providesInlineCompletion.cjs")],
        });
        try {
            await settle();
            expect(await harness.host.provideInlineCompletions({ ...REQ, languageId: "markdown" })).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("без inline-completion-провайдеров (нет расширений) → [] без RPC", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
        });
        try {
            expect(await harness.host.provideInlineCompletions(REQ)).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
