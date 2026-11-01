import { Point } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { FeatureDebounce } from "../../../../editor/common/services/languageFeatureDebounce.ts";
import { LinkedEditingController } from "../../../../editor/contrib/linkedEditing/browser/linkedEditingController.ts";

// The whole path of `registerLinkedEditingRangeProvider`: an extension in the subprocess → the core's registry →
// `LinkedEditingController` → both tags in the document and the color on the frame.

const TS_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "typescript",
    getLanguageDisplayName: () => "TypeScript",
    getRegisteredLanguageIds: () => [],
    getExtensionForLanguage: () => ".ts",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const FIXTURE = extensionFixture("test.providesLinkedEditingRanges", "providesLinkedEditingRanges.cjs");

async function open() {
    const harness = await createExtensionTestHarness({
        initialFile: { name: "main.ts", content: "<aaa></aaa>\n" },
        languageService: TS_LANGUAGE_SERVICE,
        extensions: [FIXTURE],
    });
    const editor = harness.group.getActiveEditor();
    if (editor === null) throw new Error("no active editor");
    // The harness has no workbench services: the service's part is tested on its own.
    const controller = new LinkedEditingController(editor, {
        providers: harness.languageFeatures.linkedEditingRangeProvider,
        isSettingEnabled: () => true,
        languageWordPattern: () => undefined,
        debounce: new FeatureDebounce(50, 200),
    });
    const text = (): string => editor.viewState.document.getLineContent(0);
    /** Linked after a nudge: the provider may come up after the first cursor move. */
    const linked = async (character: number): Promise<void> => {
        await waitUntil("the provider", () => harness.languageFeatures.linkedEditingRangeProvider.has(editor));
        controller.reinitialize(false);
        editor.viewState.selections = [createCursorSelection(0, character)];
        await waitUntil("the linked ranges", () => editor.viewState.linkedEditingRanges.length === 2);
    };
    return { harness, editor, controller, text, linked };
}

describe("ExtensionHost — linked editing providers (subprocess)", () => {
    it("typing in one tag rewrites the other, and one undo takes both back", async () => {
        const { harness, editor, text, linked } = await open();
        try {
            await linked(2);
            editor.pushUndo(editor.viewState.type("x"));
            await waitUntil("the mirror", () => text() === "<axaa></axaa>");

            editor.undo();
            expect(text()).toBe("<aaa></aaa>");
        } finally {
            await harness.dispose();
        }
    });

    it("the closing tag drives the opening one", async () => {
        const { harness, editor, text, linked } = await open();
        try {
            await linked(8);
            editor.pushUndo(editor.viewState.type("x"));
            await waitUntil("the mirror", () => text() === "<axaa></axaa>");
        } finally {
            await harness.dispose();
        }
    });

    it("the ranges have the color on the frame", async () => {
        const { harness, linked } = await open();
        try {
            const bgAt = (x: number): number | undefined => {
                harness.app.render();
                const screen = harness.app.backend.screenToString().split("\n");
                const y = screen.findIndex((line) => line.includes("<aaa>"));
                return harness.app.backend.getBgAt(new Point(screen[y].indexOf("<aaa>") + x, y));
            };
            const plain = bgAt(0);
            await linked(2);
            await waitUntil("the color", () => bgAt(1) !== plain);
            expect(bgAt(8)).toBe(bgAt(1));
            expect(bgAt(5)).toBe(plain);
        } finally {
            await harness.dispose();
        }
    });

    it("clearing breaks the link: the next input stays in its tag", async () => {
        const { harness, editor, controller, text, linked } = await open();
        try {
            await linked(2);
            controller.clearRanges();
            expect(editor.viewState.linkedEditingRanges).toEqual([]);

            editor.pushUndo(editor.viewState.type("x"));
            expect(text()).toBe("<axaa></aaa>");
        } finally {
            await harness.dispose();
        }
    });

    it("text the word pattern of the answer rejects stays in its tag", async () => {
        const { harness, editor, text, linked } = await open();
        try {
            await linked(2);
            editor.pushUndo(editor.viewState.type("1"));
            await waitUntil("the link to end", () => editor.viewState.linkedEditingRanges.length === 0);
            expect(text()).toBe("<a1aa></aaa>");
        } finally {
            await harness.dispose();
        }
    });
});
