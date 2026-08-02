import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { IDefinitionRequest } from "../../../../editor/common/languages/iDefinitionSource.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";

/** Мини-сервис языков: `.ts` → typescript, иначе — undefined. */
const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

function requestFor(uri: string, line: number): IDefinitionRequest {
    return { uri, languageId: "typescript", text: "const answer = compute();\nconst other = 1;\n", line, character: 6 };
}

describe("ExtensionHost — definition providers (subprocess)", () => {
    it("настоящий провайдер: Location и LocationLink доезжают как core-цели", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "const answer = compute();\nconst other = 1;\n" },
            extensions: [extensionFixture("test.providesDefinition", "providesDefinition.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            const mainUri = Uri.file(`${harness.tmpDir}/main.ts`).toString();
            const defsUri = Uri.file(`${harness.tmpDir}/defs.ts`).toString();
            const source = harness.group.definitionSource;
            expect(source).toBeDefined();

            // Строка 0 → фикстура возвращает одиночный vscode.Location.
            const fromLocation = await source!(requestFor(mainUri, 0));
            expect(fromLocation).toEqual([{ uri: defsUri, range: createRange(2, 4, 2, 9) }]);

            // Строка 1 → массив LocationLink; прицельный диапазон — targetSelectionRange.
            const fromLink = await source!(requestFor(mainUri, 1));
            expect(fromLink).toEqual([{ uri: defsUri, range: createRange(5, 9, 5, 14) }]);

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
            extensions: [extensionFixture("test.providesDefinition", "providesDefinition.cjs")],
            activateEvents: [],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await lazy.group.definitionSource!(requestFor("file:///a.ts", 0))).toEqual([]);
        } finally {
            await lazy.dispose();
        }

        // Subprocess поднят (noop активен), но definition-провайдеров никто не регистрировал.
        const noProviders = await createExtensionTestHarness({
            extensions: [extensionFixture("test.noop", "noopExtension.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            expect(await noProviders.group.definitionSource!(requestFor("file:///a.ts", 0))).toEqual([]);
        } finally {
            await noProviders.dispose();
        }
    });
});
