import { Point } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";

// The whole path of `registerDocumentHighlightProvider`: an extension in the subprocess → the core's registry →
// `WordHighlighter` → three colors on the frame.

const TS_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "typescript",
    getLanguageDisplayName: () => "TypeScript",
    getRegisteredLanguageIds: () => [],
    getExtensionForLanguage: () => ".ts",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const FIXTURE = extensionFixture("test.providesDocumentHighlights", "providesDocumentHighlights.cjs");
const SOURCE = "let x = 1; x = 2; console.log(x); const y = { x: 3 };\n";

async function open(content: string) {
    const harness = await createExtensionTestHarness({
        initialFile: { name: "main.ts", content },
        languageService: TS_LANGUAGE_SERVICE,
        extensions: [FIXTURE],
    });
    const editor = harness.group.getActiveEditor();
    if (editor === null) throw new Error("no active editor");
    const lines = (): string[] => {
        harness.app.render();
        return harness.app.backend.screenToString().split("\n");
    };
    /** The background on the frame of column `character` of the line containing `needle`. */
    const bgAt = (needle: string, character: number): number | undefined => {
        const screen = lines();
        const y = screen.findIndex((line) => line.includes(needle));
        return harness.app.backend.getBgAt(new Point(screen[y].indexOf(needle) + character, y));
    };
    // Activation is asynchronous: a query before it would pass through the textual search.
    const providerRegistered = (): Promise<void> =>
        waitUntil("the provider", () => harness.languageFeatures.documentHighlightProvider.has(editor));
    return { harness, editor, bgAt, providerRegistered };
}

describe("ExtensionHost — document highlight providers (subprocess)", () => {
    it("two reads and a write in their colors; the object key is not highlighted", async () => {
        const { harness, editor, bgAt, providerRegistered } = await open(SOURCE);
        try {
            const plain = bgAt("let x", 3);
            await providerRegistered();
            editor.viewState.selections = [createCursorSelection(0, 4)];
            await waitUntil("the write highlight", () => {
                harness.app.render();
                return editor.viewState.wordHighlights.write.length > 0;
            });

            const read = bgAt("let x", 4);
            const write = bgAt("let x", 11);
            expect(read).not.toBe(plain);
            expect(write).not.toBe(plain);
            expect(write).not.toBe(read);
            expect(bgAt("let x", 30)).toBe(read);
            // `{ x: 3 }`: same word, another symbol.
            expect(bgAt("let x", 46)).toBe(plain);
        } finally {
            await harness.dispose();
        }
    });

    it("a provider answering null leaves the document to the textual search", async () => {
        const source = "// DECLINE\nlet x = 1; x = 2;\n";
        const { harness, editor, bgAt, providerRegistered } = await open(source);
        try {
            const plain = bgAt("let x", 3);
            await providerRegistered();
            editor.viewState.selections = [createCursorSelection(1, 4)];
            await waitUntil("the textual highlight", () => {
                harness.app.render();
                return editor.viewState.wordHighlights.text.length === 2;
            });

            expect(bgAt("let x", 4)).toBe(bgAt("let x", 11));
            expect(bgAt("let x", 4)).not.toBe(plain);
        } finally {
            await harness.dispose();
        }
    });
});
