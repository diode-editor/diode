import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";

const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

interface IDumpDoc {
    uri: string;
    languageId: string;
    version: number;
    text: string;
}

interface IDumpEntry {
    kind: "activate" | "open" | "change" | "close";
    uri?: string;
    version?: number;
    text?: string;
    rangeLength?: number;
    newText?: string;
    docs?: IDumpDoc[];
}

async function dumpLog(harness: IExtensionHarness): Promise<IDumpEntry[]> {
    return (await harness.commandRegistry.execute("test.docSync.dump")) as IDumpEntry[];
}

describe("ExtensionHost — document sync producer (subprocess)", () => {
    it("an edit in the real editor reaches the extension as an exact change with the model version", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "const a = 1;\n" },
            extensions: [extensionFixture("test.docSync", "recordsDocumentSync.cjs")],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            await settle();

            // The stock vscode-languageclient reads workspace.textDocuments already in activate().
            const activate = (await dumpLog(harness)).find((e) => e.kind === "activate");
            expect(activate?.docs).toHaveLength(1);
            expect(activate?.docs?.[0].text).toBe("const a = 1;\n");
            expect(activate?.docs?.[0].languageId).toBe("typescript");
            const openVersion = activate?.docs?.[0].version ?? 0;

            const editor = harness.group.getActiveEditor();
            editor?.applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), "// intro\n")], "test edit");
            await settle();

            let changes = (await dumpLog(harness)).filter((e) => e.kind === "change");
            expect(changes).toHaveLength(1);
            expect(changes[0].text).toBe("// intro\nconst a = 1;\n");
            expect(changes[0].newText).toBe("// intro\n");
            expect(changes[0].rangeLength).toBe(0);
            expect(changes[0].version).toBe(editor?.model.document.versionId);
            expect(changes[0].version ?? 0).toBeGreaterThan(openVersion);

            editor?.applyExternalEdits([createTextEdit(createRange(1, 0, 1, 0), "let b = 2;\n")], "test edit");
            await settle();

            changes = (await dumpLog(harness)).filter((e) => e.kind === "change");
            expect(changes).toHaveLength(2);
            expect(changes[1].text).toBe("// intro\nlet b = 2;\nconst a = 1;\n");
            expect(changes[1].newText).toBe("let b = 2;\n");
            expect(changes[1].version ?? 0).toBeGreaterThan(changes[0].version ?? 0);
        } finally {
            await harness.dispose();
        }
    });

    it("didOpen on an active editor change; reopening does not duplicate the event", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.docSync", "recordsDocumentSync.cjs")],
        });
        try {
            await settle();
            const first = harness.writeFile("first.txt", "first content");
            const second = harness.writeFile("second.txt", "second content");

            harness.group.openFile(first);
            await settle();
            harness.group.openFile(second);
            await settle();
            harness.group.openFile(first);
            await settle();

            const log = await dumpLog(harness);
            expect(log.find((e) => e.kind === "activate")?.docs).toHaveLength(0);
            const opens = log.filter((e) => e.kind === "open");
            expect(opens.map((e) => e.text)).toEqual(["first content", "second content"]);
        } finally {
            await harness.dispose();
        }
    });

    it("closing the document's last tab arrives as didClose", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "const a = 1;\n" },
            extensions: [extensionFixture("test.docSync", "recordsDocumentSync.cjs")],
        });
        try {
            await settle();
            harness.group.editorGroups.activeGroup.closeTab(0);
            await settle();

            const log = await dumpLog(harness);
            const closes = log.filter((e) => e.kind === "close");
            expect(closes).toHaveLength(1);
            expect(closes[0].uri?.endsWith("main.ts")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("activation after opening a file: workspace.textDocuments already carries the full text", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [
                extensionFixture("test.noop", "noopExtension.cjs"),
                {
                    ...extensionFixture("test.docSync", "recordsDocumentSync.cjs"),
                    activationEvents: ["onLanguage:typescript"],
                },
            ],
            languageService: TS_LANGUAGE_SERVICE,
        });
        try {
            // On start() the stock languageclient sends didOpen to the server for
            // workspace.textDocuments; a wrapper with empty text would poison the server.
            const fp = harness.writeFile("late.ts", "export const late = true;\n");
            harness.group.openFile(fp);
            await settle();

            await harness.host.activateByEvent("onLanguage:typescript");
            await settle();

            const log = await dumpLog(harness);
            const activateDocs = log.find((e) => e.kind === "activate")?.docs;
            expect(activateDocs).toHaveLength(1);
            expect(activateDocs?.[0].text).toBe("export const late = true;\n");
            // VS Code semantics: a late subscriber gets no events and finds the
            // documents itself in workspace.textDocuments.
            expect(log.filter((e) => e.kind === "open")).toHaveLength(0);
        } finally {
            await harness.dispose();
        }
    });
});
