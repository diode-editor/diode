import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    provideHovers,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
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

/** Версия для запросов по документу без открытого редактора: ответ пустой при любой. */
const UNOPENED_VERSION = 1;

function requestFor(uri: string, line: number, versionId: number): IHoverRequest {
    return { uri, languageId: "typescript", versionId, line, character: 6 };
}

describe("ExtensionHost — hover providers (subprocess)", () => {
    it("два настоящих провайдера: hover'ы доезжают конкатенацией, при равном score — новый первым", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "const answer = compute();\nconst other = 1;\n" },
            extensions: [extensionFixture("test.providesHover", "providesHover.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            const mainUri = Uri.file(`${harness.tmpDir}/main.ts`).toString();
            // Оба провайдера объявлены реестру ядра под селектором typescript.
            const target = { uri: Uri.parse(mainUri), languageId: "typescript" };
            expect(harness.languageFeatures.hoverProvider.ordered(target)).toHaveLength(2);
            expect(harness.languageFeatures.hoverProvider.has({ ...target, languageId: "markdown" })).toBe(false);

            // Строка 0 → оба провайдера отвечают; у второго MarkedString-codeblock
            // сериализован в fenced-блок, range'а у него нет. Score у обоих
            // одинаковый, поэтому первым идёт зарегистрированный позже (как в vscode).
            const hovers = await provideHovers(harness, requestFor(mainUri, 0, documentVersion(harness, mainUri)));
            expect(hovers).toEqual([
                { contents: ["```ts\ncompute(): number\n```"] },
                { contents: ["```ts\nconst answer: number\n```"], range: createRange(0, 6, 0, 12) },
            ]);

            // Строка 1 → оба молчат: пустой ответ, не мусор.
            expect(await provideHovers(harness, requestFor(mainUri, 1, documentVersion(harness, mainUri)))).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("без subprocess'а и без провайдеров реестр hover пуст", async () => {
        // Расширение зарегистрировано, но не активировано — subprocess не поднят.
        const lazy = await createExtensionTestHarness({
            extensions: [extensionFixture("test.providesHover", "providesHover.cjs")],
            activateEvents: [],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await provideHovers(lazy, requestFor("file:///a.ts", 0, UNOPENED_VERSION))).toEqual([]);
        } finally {
            await lazy.dispose();
        }

        // Subprocess поднят (noop активен), но hover-провайдеров никто не регистрировал.
        const noProviders = await createExtensionTestHarness({
            extensions: [extensionFixture("test.noop", "noopExtension.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await provideHovers(noProviders, requestFor("file:///a.ts", 0, UNOPENED_VERSION))).toEqual([]);
        } finally {
            await noProviders.dispose();
        }
    });
});
