import { describe, expect, it } from "vitest";

import {
    completionTriggerCharacters,
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    type IExtensionHarness,
    provideCompletions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ICompletionRequest } from "../../../../editor/common/languages/iCompletionSource.ts";

// НАСТОЯЩИЙ subprocess: id пункта обязан пережить сериализацию и найтись в кэше ответа.

function requestIn(harness: IExtensionHarness): ICompletionRequest {
    const uri = Uri.file(`${harness.tmpDir}/.editorconfig`).toString();
    return { uri, languageId: "editorconfig", versionId: documentVersion(harness, uri), line: 0, character: 3 };
}

describe("ExtensionHost — resolveCompletionItem (subprocess)", () => {
    it("догружает detail/documentation/правки и раздаёт триггер-символы", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: ".editorconfig", content: "ind" },
            extensions: [extensionFixture("test.resolvesCompletion", "resolvesCompletion.cjs")],
        });
        try {
            await settle();

            expect(completionTriggerCharacters(harness, requestIn(harness)).sort()).toEqual([".", "="]);

            const { items } = await provideCompletions(harness, requestIn(harness));
            expect(items).toHaveLength(1);
            expect(items[0].detail).toBeUndefined();

            const resolved = await harness.host.resolveCompletionItem(items[0].id!);
            expect(resolved?.detail).toBe("resolved detail");
            expect(resolved?.documentation).toBe("resolved docs");
            expect(resolved?.additionalEdits).toEqual([
                { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "# header\n" },
            ]);
        } finally {
            await harness.dispose();
        }
    });

    it("правки из самого списка доезжают до ядра и без resolve-провайдера (gopls)", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: ".editorconfig", content: "ind" },
            extensions: [extensionFixture("test.eagerEditsCompletion", "eagerEditsCompletion.cjs")],
        });
        try {
            await settle();

            const { items } = await provideCompletions(harness, requestIn(harness));
            expect(items).toHaveLength(1);
            expect(items[0].additionalEdits).toEqual([
                { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "# header\n" },
            ]);
            expect(await harness.host.resolveCompletionItem(items[0].id!)).toBeNull();
        } finally {
            await harness.dispose();
        }
    });

    it("без провайдеров резолвить нечего → null без RPC", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
        });
        try {
            expect(await harness.host.resolveCompletionItem("1.0")).toBeNull();
            expect(
                completionTriggerCharacters(harness, {
                    uri: Uri.file("/proj/.editorconfig").toString(),
                    languageId: "editorconfig",
                }),
            ).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
