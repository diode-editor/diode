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

// Save As changes the uri of THE SAME model; without close/open the host treats the new uri
// as unsynced and silently returns empty for every provider request.

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

describe("ExtensionHost — document sync on Save As (subprocess)", () => {
    it("Save As: the extension sees close of the old uri and open of the new one with the new language; the provider answers for the new uri", async () => {
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

    it("closing the tab after Save As closes the new uri for the extension, the old one is no longer open", async () => {
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
