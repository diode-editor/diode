import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    type IExtensionHarness,
    provideInlineCompletions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import {
    type IInlineCompletionRequest,
    InlineCompletionTriggerKind,
} from "../../../../editor/common/languages/iInlineCompletionSource.ts";

function requestIn(harness: IExtensionHarness): IInlineCompletionRequest {
    const uri = Uri.file(`${harness.tmpDir}/main.ts`).toString();
    return {
        uri,
        languageId: "typescript",
        versionId: documentVersion(harness, uri),
        line: 0,
        character: 12,
        triggerKind: InlineCompletionTriggerKind.Automatic,
    };
}

describe("ExtensionHost — inline completion bridge (subprocess)", () => {
    it("provideInlineCompletions возвращает пункты провайдера: plain-текст и сниппет со стрипом", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "function fib" },
            extensions: [extensionFixture("test.providesInlineCompletion", "providesInlineCompletion.cjs")],
        });
        try {
            await settle();

            const items = await provideInlineCompletions(harness, requestIn(harness), CancellationTokenNone);
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
            expect(await provideInlineCompletions(harness, { ...requestIn(harness), languageId: "markdown" })).toEqual(
                [],
            );
        } finally {
            await harness.dispose();
        }
    });

    it("без inline-completion-провайдеров (нет расширений) → [] без RPC", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
        });
        try {
            expect(await provideInlineCompletions(harness, requestIn(harness))).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    // Срок едет в ЗАПРОСЕ: правка настройки применяется без перезапуска. Фикстура
    // отвечает ~300 мс — тесный срок её не дождётся, хостовой дефолт (5000 мс) дождётся.
    it("req.timeoutMs перебивает хостовой таймаут: тесный срок сдаётся, отсутствие срока — ждёт", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "function fib" },
            extensions: [extensionFixture("test.slowInlineCompletion", "providesSlowInlineCompletion.cjs")],
        });
        try {
            await settle();

            expect(await provideInlineCompletions(harness, { ...requestIn(harness), timeoutMs: 50 })).toEqual([]);

            // Срока в запросе нет → работает хостовой дефолт, ответ дожидается.
            expect(await provideInlineCompletions(harness, requestIn(harness))).toEqual([
                { insertText: "onacci(n) {}" },
            ]);

            expect(await provideInlineCompletions(harness, { ...requestIn(harness), timeoutMs: 20000 })).toEqual([
                { insertText: "onacci(n) {}" },
            ]);
        } finally {
            await harness.dispose();
        }
    });
});
