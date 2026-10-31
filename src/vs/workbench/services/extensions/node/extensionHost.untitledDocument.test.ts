import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";

const FIXTURE = extensionFixture("test.untitled", "opensUntitledDocument.cjs");

interface IOpenResult {
    document: {
        uri: string;
        scheme: string;
        isUntitled: boolean;
        isDirty: boolean;
        languageId: string;
        text: string;
    };
    inTextDocuments: boolean;
    firedOnDidOpen: boolean;
    editor?: { sameDocument: boolean; isActive: boolean; viewColumn: number };
}

async function open(harness: IExtensionHarness, options: Record<string, unknown>): Promise<IOpenResult> {
    return (await harness.commandRegistry.execute("test.untitled.open", options)) as IOpenResult;
}

describe("ExtensionHost — untitled document openTextDocument({ content, language }) (subprocess)", () => {
    it("document untitled:Untitled-N is dirty, has text and language, is already in textDocuments; no tab", async () => {
        const harness = await createExtensionTestHarness({ extensions: [FIXTURE] });
        try {
            const result = await open(harness, { content: "# Tools\n\ngo: /usr/bin/go\n", language: "markdown" });

            expect(result.document).toEqual({
                uri: "untitled:Untitled-1",
                scheme: "untitled",
                isUntitled: true,
                isDirty: true,
                languageId: "markdown",
                text: "# Tools\n\ngo: /usr/bin/go\n",
            });
            expect(result.inTextDocuments).toBe(true);
            expect(result.firedOnDidOpen).toBe(true);
            expect(harness.group.editorGroups.activeGroup.editorCount).toBe(0);
        } finally {
            await harness.dispose();
        }
    });

    it("showTextDocument shows it as an Untitled-N tab over the same document", async () => {
        const harness = await createExtensionTestHarness({ extensions: [FIXTURE] });
        try {
            const result = await open(harness, { content: "report", language: "markdown", show: true });

            expect(result.editor).toEqual({ sameDocument: true, isActive: true, viewColumn: 1 });
            const editor = harness.group.getActiveEditor();
            expect(editor?.uri.toString()).toBe("untitled:Untitled-1");
            expect(editor?.label).toBe("Untitled-1");
            expect(editor?.getText()).toBe("report");
            expect(editor?.isModified).toBe(true);
            expect(editor?.readOnly).toBe(false);
            expect(editor?.languageId).toBe("markdown");
        } finally {
            await harness.dispose();
        }
    });

    it("without options: an empty plaintext buffer that reads as dirty (as upstream), numbers go in order", async () => {
        const harness = await createExtensionTestHarness({ extensions: [FIXTURE] });
        try {
            const first = await open(harness, {});
            const second = await open(harness, {});

            expect(first.document).toMatchObject({ uri: "untitled:Untitled-1", isDirty: true, text: "" });
            expect(first.document.languageId).toBe("plaintext");
            expect(second.document.uri).toBe("untitled:Untitled-2");
        } finally {
            await harness.dispose();
        }
    });
});
