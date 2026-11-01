import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { FormatOnTypeController } from "../../../../editor/contrib/format/browser/formatOnType.ts";

// The whole path of `registerOnTypeFormattingEditProvider`: an extension in the subprocess → the core's registry →
// `FormatOnTypeController` → the line on the frame.

const TS_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "typescript",
    getLanguageDisplayName: () => "TypeScript",
    getRegisteredLanguageIds: () => [],
    getExtensionForLanguage: () => ".ts",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const FIXTURE = extensionFixture("test.providesOnTypeFormattingEdits", "providesOnTypeFormattingEdits.cjs");

async function open(enabled: boolean) {
    const harness = await createExtensionTestHarness({
        initialFile: { name: "main.ts", content: "int x=1\n" },
        languageService: TS_LANGUAGE_SERVICE,
        extensions: [FIXTURE],
    });
    const editor = harness.group.getActiveEditor();
    if (editor === null) throw new Error("no active editor");
    // The harness has no workbench services: the service's part is tested on its own.
    const controller = new FormatOnTypeController(editor, {
        providers: harness.languageFeatures.onTypeFormattingEditProvider,
        isSettingEnabled: () => enabled,
    });
    await waitUntil("the provider", () => harness.languageFeatures.onTypeFormattingEditProvider.has(editor));
    editor.viewState.selections = [createCursorSelection(0, 7)];
    const frame = (): string => {
        harness.app.render();
        return harness.app.backend.screenToString();
    };
    return { harness, editor, controller, frame };
}

describe("ExtensionHost — on type formatting providers (subprocess)", () => {
    it("the trigger character formats the line, on the frame, with the caret after it", async () => {
        const { harness, editor, frame } = await open(true);
        try {
            editor.typeText(";");
            await waitUntil("the format", () => frame().includes("int x = 1;"));
            expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 10 });

            editor.undo();
            expect(editor.viewState.document.getLineContent(0)).toBe("int x=1;");
        } finally {
            await harness.dispose();
        }
    });

    it("Enter is a trigger from the extension's list", async () => {
        const { harness, editor } = await open(true);
        try {
            editor.typeText("\n");
            await waitUntil("the format", () => editor.viewState.document.getLineContent(0) === "int x = 1");
            expect(editor.viewState.selections[0].active.line).toBe(1);
        } finally {
            await harness.dispose();
        }
    });

    it("with editor.formatOnType off nothing happens", async () => {
        const { harness, editor, frame } = await open(false);
        try {
            editor.typeText(";");
            await new Promise((resolve) => setTimeout(resolve, 200));
            expect(frame()).toContain("int x=1;");
        } finally {
            await harness.dispose();
        }
    });
});
