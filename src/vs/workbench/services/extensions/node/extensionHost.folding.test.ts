import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";

/** Язык-сервис, размечающий всё как csharp (селектор maptz/фикстуры совпадёт). */
const CSHARP_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "csharp",
    getLanguageDisplayName: () => "C#",
    getExtensionForLanguage: () => ".cs",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const CSHARP_TEXT = ["/* #region A */", "int a;", "int b;", "/* #endregion */", "int c;"].join("\n");

const REQ = {
    uri: Uri.file("/proj/Program.cs").toString(),
    languageId: "csharp",
    text: CSHARP_TEXT,
};

describe("ExtensionHost — folding bridge (subprocess)", () => {
    it("provideFoldingRanges возвращает регионы провайдера", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.providesFolding", "providesFolding.cjs")],
        });
        try {
            await settle();
            // Через group.foldingRangeSource (wiring харнесса) — как это делает ядро.
            const regions = await harness.group.foldingRangeSource!(REQ);
            expect(regions).toEqual([{ startLine: 0, endLine: 3, isCollapsed: false }]);
        } finally {
            await harness.dispose();
        }
    });

    it("селектор другого языка → пустой результат", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.providesFolding", "providesFolding.cjs")],
        });
        try {
            await settle();
            const regions = await harness.host.provideFoldingRanges({ ...REQ, languageId: "typescript" });
            expect(regions).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("без folding-провайдеров (нет расширений) → [] без RPC", async () => {
        const harness = await createExtensionTestHarness({});
        try {
            const regions = await harness.host.provideFoldingRanges(REQ);
            expect(regions).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("поздняя активация: фолды подъезжают в уже открытый редактор", async () => {
        // Файл открыт ДО активации расширения (как в реальном main.ts на
        // onStartupFinished). Провайдер должен пере-триггерить пересчёт фолдов.
        const harness = await createExtensionTestHarness({
            initialFile: { name: "Program.cs", content: CSHARP_TEXT },
            languageService: CSHARP_LANGUAGE_SERVICE,
            extensions: [extensionFixture("test.providesFolding", "providesFolding.cjs")],
        });
        try {
            await harness.flushRpc(6);
            await settle();
            await harness.flushRpc(6);
            const regions = harness.group.getActiveEditor()?.viewState.foldedRegions ?? [];
            expect(regions.some((r) => r.startLine === 0 && r.endLine === 3)).toBe(true);
        } finally {
            await harness.dispose();
        }
    });
});
