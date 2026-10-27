import { afterEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { type ILanguageService, NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import type { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

const LINE = 1;
const BLOCK = 2;
const UNDERLINE = 3;

const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

/**
 * `TextEditor.options.cursorStyle` (#888) on the edges a vim-like extension hits: tab switches, a burst
 * of mode changes, untitled buffers, a settings change between two assignments. Always the active
 * editor, through the real subprocess, down to the terminal cursor.
 */
describe("ExtensionHost — TextEditor.options.cursorStyle edges", () => {
    let harness: IExtensionHarness | undefined;

    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
    });

    async function setup(settings: Record<string, unknown>) {
        const configuration: InMemoryConfigurationService = createTestConfigurationService(settings);
        const h = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "const a = 1;\n" },
            extensions: [extensionFixture("test.cursorActive", "cursorStyleActiveExtension.cjs")],
            configurationService: configuration,
            extensionConfigurationService: configuration,
            languageService: TS_LANGUAGE_SERVICE,
        });
        harness = h;
        await settle();
        /** The terminal cursor of the active editor. */
        const cursor = () => {
            const pane = h.group.editorGroups.activeGroup.activePane;
            if (pane instanceof TextEditorPane) pane.focusEditor();
            h.app.render();
            return h.app.backend.cursorStyle;
        };
        const set = async (...styles: unknown[]): Promise<unknown> => {
            const after = await h.commandRegistry.execute("test.cursorActive.set", ...styles);
            await settle();
            return after;
        };
        const get = async (): Promise<unknown> => h.commandRegistry.execute("test.cursorActive.get");
        const open = async (filePath: string) => {
            h.group.openFile(filePath, { preview: false });
            await settle();
        };
        return { h, configuration, cursor, set, get, open };
    }

    it("switching to another tab and back keeps the override, and the getter agrees with the cursor", async () => {
        const { h, cursor, set, get, open } = await setup({ "editor.cursorStyle": "line" });
        const main = h.group.editorGroups.activeGroup.activePane as TextEditorPane;
        const mainPath = main.uri.fsPath;
        await set(BLOCK);
        expect(cursor()).toEqual({ shape: "block", blinking: true });

        await open(h.writeFile("other.ts", "const b = 2;\n"));
        expect(cursor()).toEqual({ shape: "bar", blinking: true });
        await open(mainPath);

        expect(cursor()).toEqual({ shape: "block", blinking: true });
        expect(await get()).toBe(BLOCK);
    });

    it("after a tab switch, the vim insert-mode Line still turns the block back into a bar", async () => {
        const { h, cursor, set, open } = await setup({ "editor.cursorStyle": "line" });
        const mainPath = (h.group.editorGroups.activeGroup.activePane as TextEditorPane).uri.fsPath;
        await set(BLOCK);
        await open(h.writeFile("other.ts", "const b = 2;\n"));
        await open(mainPath);

        await set(LINE);
        expect(cursor()).toEqual({ shape: "bar", blinking: true });
    });

    it("a burst of mode changes in one tick ends on the last style", async () => {
        const { cursor, set, get } = await setup({});
        expect(await set(BLOCK, LINE, UNDERLINE)).toBe(UNDERLINE);
        expect(cursor()).toEqual({ shape: "underline", blinking: true });
        expect(await get()).toBe(UNDERLINE);

        expect(await set(LINE, BLOCK)).toBe(BLOCK);
        expect(cursor()).toEqual({ shape: "block", blinking: true });
    });

    it("null and undefined are ignored like any value outside the enum", async () => {
        const { cursor, set, get } = await setup({});
        await set(BLOCK);
        expect(await set(null)).toBe(BLOCK);
        expect(await set(undefined)).toBe(BLOCK);
        expect(await get()).toBe(BLOCK);
        expect(cursor()).toEqual({ shape: "block", blinking: true });
    });

    it("assigning only tabSize keeps the style override", async () => {
        const { h, cursor, set } = await setup({ "editor.cursorStyle": "line" });
        await set(BLOCK);
        expect(await h.commandRegistry.execute("test.cursorActive.setTabSize", 2)).toBe(BLOCK);
        await settle();
        expect(cursor()).toEqual({ shape: "block", blinking: true });
    });

    it("an untitled editor takes the style too", async () => {
        const { h, cursor, set, get } = await setup({ "editor.cursorStyle": "line" });
        h.group.newUntitled();
        await settle();
        expect(h.group.editorGroups.activeGroup.activePane).toBeInstanceOf(TextEditorPane);
        expect(await set(BLOCK)).toBe(BLOCK);
        expect(cursor()).toEqual({ shape: "block", blinking: true });
        expect(await get()).toBe(BLOCK);
    });

    it("after the setting moves to block, the extension's Line still makes a bar", async () => {
        const { configuration, cursor, set, get } = await setup({ "editor.cursorStyle": "line" });
        expect(await get()).toBe(LINE);

        await configuration.updateValue("editor.cursorStyle", "block");
        await settle();
        expect(cursor()).toEqual({ shape: "block", blinking: true });
        expect(await get()).toBe(BLOCK);

        await set(LINE);
        expect(cursor()).toEqual({ shape: "bar", blinking: true });
        expect(await get()).toBe(LINE);
    });

    it("the language override of editor.cursorStyle shapes the cursor and the getter", async () => {
        const { cursor, get } = await setup({
            "editor.cursorStyle": "line",
            "[typescript]": { "editor.cursorStyle": "underline" },
        });
        expect(cursor()).toEqual({ shape: "underline", blinking: true });
        expect(await get()).toBe(UNDERLINE);
    });

    it("closing one of two split editors of the same file keeps the other's override", async () => {
        const { h, set } = await setup({ "editor.cursorStyle": "line" });
        h.group.splitActiveGroup();
        await settle();
        const groups = h.group.editorGroups.groups;
        expect(groups).toHaveLength(2);
        // The split is active: shape it, then close the original.
        expect(h.group.editorGroups.activeGroup).toBe(groups[1]);
        const split = groups[1].getPane(0) as TextEditorPane;
        const splitApp = TestApp.createWithContent(split.view);
        await set(BLOCK);

        const first = groups[0];
        expect(await h.group.closeEditor(first, first.getPane(0)!)).toBe(true);
        await settle();
        expect(h.group.editorGroups.activeGroup.activePane).toBe(split);
        split.focusEditor();
        splitApp.render();
        expect(splitApp.backend.cursorStyle).toEqual({ shape: "block", blinking: true });
    });
});
