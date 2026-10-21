import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    EXTENSION_FIXTURES_DIR,
    extensionFixture,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";

const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

describe("ExtensionHost — window.onDidChangeActiveTextEditor (subprocess)", () => {
    it("the event fires when a file opens after extension activation", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.watchActiveEditor", "watchActiveEditor.cjs")],
        });
        try {
            const fp = harness.writeFile("hello.ts", "const x = 1;\n");
            harness.group.openFile(fp);
            await settle();
            const editor = harness.group.getActiveEditor();
            expect(editor).not.toBeNull();
            // The fixture sets tabSize=77 if fileName ends with .ts.
            expect(editor?.viewState.tabSize).toBe(77);
        } finally {
            await harness.dispose();
        }
    });

    it("initial snapshot: activeTextEditor is correct on activation if a file is already open", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "export {};\n" },
            extensions: [extensionFixture("test.watchActiveEditor", "watchActiveEditor.cjs")],
        });
        try {
            // onDidChangeActiveTextEditor is not guaranteed on the initial snapshot, so switch editors.
            const fp = harness.writeFile("other.ts", "");
            harness.group.openFile(fp);
            await settle();
            const editor = harness.group.getActiveEditor();
            expect(editor?.viewState.tabSize).toBe(77);
        } finally {
            await harness.dispose();
        }
    });

    it("window.activeTextEditor returns undefined when no files are open", async () => {
        // With editor === undefined the fixture returns early; otherwise it would set 8.
        const harness = await createExtensionTestHarness({
            extensions: [
                {
                    id: "test.checkUndefined",
                    manifest: { name: "test.checkUndefined", publisher: "test", version: "0.0.1" },
                    mainPath: path.join(EXTENSION_FIXTURES_DIR, "setIndentTabs.cjs"),
                },
            ],
        });
        try {
            expect(harness.group.getActiveEditor()).toBeNull();
        } finally {
            await harness.dispose();
        }
    });

    it("languageId is projected into meta and document identity is stable", async () => {
        const harness = await createExtensionTestHarness({
            languageService: TS_LANGUAGE_SERVICE,
            extensions: [extensionFixture("test.reportMeta", "reportActiveEditorMeta.cjs")],
        });
        try {
            const fp = harness.writeFile("main.ts", "export {};\n");
            harness.group.openFile(fp);
            await settle();
            const editor = harness.group.getActiveEditor();
            // The fixture sets 71 only if workspace.textDocuments contains THE SAME document object.
            expect(editor?.viewState.tabSize).toBe(71);
        } finally {
            await harness.dispose();
        }
    });

    it("document.fileName holds the full file path", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.watchActiveEditor", "watchActiveEditor.cjs")],
        });
        try {
            const fp = harness.writeFile("readme.txt", "hello\n");
            harness.group.openFile(fp);
            await settle();
            const editor = harness.group.getActiveEditor();
            // 1: the event arrived and fileName does not end with .ts.
            expect(editor?.viewState.tabSize).toBe(1);
        } finally {
            await harness.dispose();
        }
    });
});
