import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import type { IReferenceRequest } from "../../../../editor/common/languages/iReferenceSource.ts";

/** Мини-сервис языков: `.ts` → typescript, иначе — undefined. */
const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

const TEXT = "const answer = compute();\nconst other = 1;\n";

function requestFor(uri: string, line: number, includeDeclaration = true): IReferenceRequest {
    return { uri, languageId: "typescript", text: TEXT, line, character: 6, includeDeclaration };
}

describe("ExtensionHost — reference providers (subprocess)", () => {
    it("два настоящих провайдера: ссылки доезжают конкатенацией в порядке регистрации", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: TEXT },
            extensions: [extensionFixture("test.providesReferences", "providesReferences.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            const mainUri = Uri.file(`${harness.tmpDir}/main.ts`).toString();
            const otherUri = mainUri.replace("main.ts", "other.ts");
            const source = harness.group.referenceSource;
            expect(source).toBeDefined();

            // Строка 0 → отвечают оба: объявление + ссылка от первого, чужой
            // файл от второго.
            expect(await source!(requestFor(mainUri, 0))).toEqual([
                { uri: mainUri, range: createRange(0, 0, 0, 5) },
                { uri: mainUri, range: createRange(0, 6, 0, 12) },
                { uri: otherUri, range: createRange(7, 2, 7, 8) },
            ]);

            // includeDeclaration: false доезжает до провайдера настоящим
            // `ReferenceContext` — объявления в ответе больше нет.
            expect(await source!(requestFor(mainUri, 0, false))).toEqual([
                { uri: mainUri, range: createRange(0, 6, 0, 12) },
                { uri: otherUri, range: createRange(7, 2, 7, 8) },
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
            extensions: [extensionFixture("test.providesReferences", "providesReferences.cjs")],
            activateEvents: [],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await lazy.group.referenceSource!(requestFor("file:///a.ts", 0))).toEqual([]);
        } finally {
            await lazy.dispose();
        }

        // Subprocess поднят (noop активен), но references-провайдеров никто не регистрировал.
        const noProviders = await createExtensionTestHarness({
            extensions: [extensionFixture("test.noop", "noopExtension.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await noProviders.group.referenceSource!(requestFor("file:///a.ts", 0))).toEqual([]);
        } finally {
            await noProviders.dispose();
        }
    });
});
