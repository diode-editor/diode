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
    it("provideInlineCompletions returns provider items: plain text and a stripped snippet", async () => {
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

    it("a selector for another language → empty result", async () => {
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

    it("no inline completion providers (no extensions) → [] without RPC", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
        });
        try {
            expect(await provideInlineCompletions(harness, requestIn(harness))).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    // The deadline travels in the REQUEST: a settings change applies without a restart. The fixture
    // answers in ~300 ms: a tight deadline won't wait for it, the host default (5000 ms) will.
    it("req.timeoutMs overrides the host timeout: a tight deadline gives up, no deadline waits", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "function fib" },
            extensions: [extensionFixture("test.slowInlineCompletion", "providesSlowInlineCompletion.cjs")],
        });
        try {
            await settle();

            expect(await provideInlineCompletions(harness, { ...requestIn(harness), timeoutMs: 50 })).toEqual([]);

            // No deadline in the request → the host default applies and the response arrives.
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
