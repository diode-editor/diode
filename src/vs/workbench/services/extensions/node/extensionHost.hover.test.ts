import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { IHoverRequest } from "../../../../editor/common/languages/iHoverSource.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";

/** Мини-сервис языков: `.ts` → typescript, иначе — undefined. */
const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

function requestFor(uri: string, line: number): IHoverRequest {
    return { uri, languageId: "typescript", text: "const answer = compute();\nconst other = 1;\n", line, character: 6 };
}

describe("ExtensionHost — hover providers (subprocess)", () => {
    it("два настоящих провайдера: hover'ы доезжают конкатенацией в порядке регистрации", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "const answer = compute();\nconst other = 1;\n" },
            extensions: [extensionFixture("test.providesHover", "providesHover.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            const mainUri = Uri.file(`${harness.tmpDir}/main.ts`).toString();
            const source = harness.group.hoverSource;
            expect(source).toBeDefined();

            // Строка 0 → оба провайдера отвечают; у второго MarkedString-codeblock
            // сериализован в fenced-блок, range'а у него нет.
            const hovers = await source!(requestFor(mainUri, 0));
            expect(hovers).toEqual([
                { contents: ["```ts\nconst answer: number\n```"], range: createRange(0, 6, 0, 12) },
                { contents: ["```ts\ncompute(): number\n```"] },
            ]);

            // Строка 1 → оба молчат: пустой ответ, не мусор.
            expect(await source!(requestFor(mainUri, 1))).toEqual([]);

            // Слишком большой документ не гоняется через RPC.
            const huge = await source!({ ...requestFor(mainUri, 0), text: "x".repeat(8 * 1024 * 1024 + 1) });
            expect(huge).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("без subprocess'а и без провайдеров источник отдаёт []", async () => {
        // Расширение зарегистрировано, но не активировано — subprocess не поднят.
        const lazy = await createExtensionTestHarness({
            extensions: [extensionFixture("test.providesHover", "providesHover.cjs")],
            activateEvents: [],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await lazy.group.hoverSource!(requestFor("file:///a.ts", 0))).toEqual([]);
        } finally {
            await lazy.dispose();
        }

        // Subprocess поднят (noop активен), но hover-провайдеров никто не регистрировал.
        const noProviders = await createExtensionTestHarness({
            extensions: [extensionFixture("test.noop", "noopExtension.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await noProviders.group.hoverSource!(requestFor("file:///a.ts", 0))).toEqual([]);
        } finally {
            await noProviders.dispose();
        }
    });
});
