import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    type IExtensionHarness,
    provideFoldingRegions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";

// Save As меняет uri (и язык) у ТОЙ ЖЕ модели. Для расширений это смена
// документа, как в эталоне: onDidClose старого uri и onDidOpen нового — с
// новым languageId. Иначе хост считает новый uri несинхронизированным и молча
// отвечает пустым результатом на каждый запрос провайдера (семантика, folding).

/** `.cs` → csharp (селектор фикстуры folding), остальное — plaintext. */
const CSHARP_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".cs") ? "csharp" : undefined),
    getLanguageDisplayName: () => undefined,
};

const CSHARP_TEXT = ["/* #region A */", "int a;", "/* #endregion */", ""].join("\n");

interface IDumpEntry {
    kind: "activate" | "open" | "change" | "close";
    uri?: string;
    languageId?: string;
    text?: string;
}

async function dumpLog(harness: IExtensionHarness): Promise<IDumpEntry[]> {
    return (await harness.commandRegistry.execute("test.docSync.dump")) as IDumpEntry[];
}

function uriIn(harness: IExtensionHarness, name: string): string {
    return Uri.file(`${harness.tmpDir}/${name}`).toString();
}

describe("ExtensionHost — document sync на Save As (subprocess)", () => {
    it("Save As: расширение видит close старого uri и open нового с новым языком; провайдер отвечает по новому uri", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "Program.cs", content: CSHARP_TEXT },
            languageService: CSHARP_LANGUAGE_SERVICE,
            extensions: [
                extensionFixture("test.docSync", "recordsDocumentSync.cjs"),
                extensionFixture("test.providesFolding", "providesFolding.cjs"),
            ],
        });
        try {
            await settle();
            const editor = harness.group.getActiveEditor()!;

            await editor.saveAs(`${harness.tmpDir}/Program.txt`);
            await settle();
            await editor.saveAs(`${harness.tmpDir}/Program2.cs`);
            await settle();

            const events = (await dumpLog(harness))
                .filter((e) => e.kind === "open" || e.kind === "close")
                .map((e) => ({ kind: e.kind, uri: e.uri, languageId: e.languageId }));
            expect(events).toEqual([
                { kind: "close", uri: uriIn(harness, "Program.cs"), languageId: "csharp" },
                { kind: "open", uri: uriIn(harness, "Program.txt"), languageId: "plaintext" },
                { kind: "close", uri: uriIn(harness, "Program.txt"), languageId: "plaintext" },
                { kind: "open", uri: uriIn(harness, "Program2.cs"), languageId: "csharp" },
            ]);

            // Новый uri синхронизирован: запрос доходит до провайдера субпроцесса.
            const uri = uriIn(harness, "Program2.cs");
            const regions = await provideFoldingRegions(harness, {
                uri,
                languageId: "csharp",
                versionId: documentVersion(harness, uri),
            });
            expect(regions).toEqual([{ startLine: 0, endLine: 2, isCollapsed: false }]);
        } finally {
            await harness.dispose();
        }
    });

    it("закрытие вкладки после Save As закрывает расширению новый uri, старый больше не открыт", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "Program.cs", content: CSHARP_TEXT },
            languageService: CSHARP_LANGUAGE_SERVICE,
            extensions: [extensionFixture("test.docSync", "recordsDocumentSync.cjs")],
        });
        try {
            await settle();
            await harness.group.getActiveEditor()!.saveAs(`${harness.tmpDir}/Renamed.cs`);
            await settle();
            harness.group.editorGroups.activeGroup.closeTab(0);
            await settle();

            const closes = (await dumpLog(harness)).filter((e) => e.kind === "close").map((e) => e.uri);
            expect(closes).toEqual([uriIn(harness, "Program.cs"), uriIn(harness, "Renamed.cs")]);
        } finally {
            await harness.dispose();
        }
    });
});
