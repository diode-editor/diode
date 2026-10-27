import { afterEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import type { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

const LINE = 1;
const BLOCK = 2;
const UNDERLINE = 3;

/**
 * `TextEditor.options.cursorStyle` (#888) through the real subprocess: the extension's style reaches the
 * terminal cursor of the editor it was set on, as vscodevim switches normal and insert mode.
 */
describe("ExtensionHost — TextEditor.options.cursorStyle", () => {
    let harness: IExtensionHarness | undefined;

    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
    });

    /** Two groups with `main.ts` each: the harness app renders the first, a second app the other. */
    async function setup(settings: Record<string, unknown>) {
        const configuration: InMemoryConfigurationService = createTestConfigurationService(settings);
        const h = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "const a = 1;\n" },
            extensions: [extensionFixture("test.cursor", "cursorStyleExtension.cjs")],
            configurationService: configuration,
            extensionConfigurationService: configuration,
        });
        harness = h;
        h.group.splitActiveGroup();
        await settle();
        const pane = (column: 1 | 2): TextEditorPane => {
            const found = h.group.editorGroups.groups[column - 1].getPane(0);
            expect(found).toBeInstanceOf(TextEditorPane);
            return found as TextEditorPane;
        };
        const apps = { 1: h.app, 2: TestApp.createWithContent(pane(2).view) };
        /** The terminal cursor while the editor in `column` has focus. */
        const cursorIn = (column: 1 | 2) => {
            pane(column).focusEditor();
            apps[column].render();
            return apps[column].backend.cursorStyle;
        };
        const set = async (column: 1 | 2, style: unknown): Promise<unknown> => {
            const after = await h.commandRegistry.execute("test.cursor.set", column, style);
            await settle();
            return after;
        };
        const get = async (column: 1 | 2): Promise<unknown> => h.commandRegistry.execute("test.cursor.get", column);
        return { h, configuration, pane, cursorIn, set, get };
    }

    it("vscode.TextEditorCursorStyle carries upstream's values", async () => {
        const { h } = await setup({});
        expect(await h.commandRegistry.execute("test.cursor.enum")).toMatchObject({
            Line: 1,
            Block: 2,
            Underline: 3,
            LineThin: 4,
            BlockOutline: 5,
            UnderlineThin: 6,
        });
    });

    it("Block on one of two split editors shapes only that editor; the getter has it at once", async () => {
        const { h, cursorIn, set, get } = await setup({ "editor.cursorStyle": "line" });
        expect(cursorIn(1)).toEqual({ shape: "bar", blinking: true });
        expect(cursorIn(2)).toEqual({ shape: "bar", blinking: true });

        // Set on the editor that is not the active one: it takes the shape when it gets focus.
        h.group.editorGroups.focusGroup({ index: 1 });
        expect(h.group.editorGroups.activeGroup).toBe(h.group.editorGroups.groups[1]);
        expect(await set(1, BLOCK)).toBe(BLOCK);

        expect(cursorIn(2)).toEqual({ shape: "bar", blinking: true });
        expect(cursorIn(1)).toEqual({ shape: "block", blinking: true });
        expect(await get(1)).toBe(BLOCK);
        expect(await get(2)).toBe(LINE);

        // Back to the bar, as vim leaving normal mode for insert.
        expect(await set(1, LINE)).toBe(LINE);
        expect(cursorIn(1)).toEqual({ shape: "bar", blinking: true });
    });

    it("a value outside the enum changes nothing", async () => {
        const { cursorIn, set, get } = await setup({});
        expect(await set(1, BLOCK)).toBe(BLOCK);

        for (const invalid of [0, 7, 2.5, "2"]) {
            expect(await set(1, invalid)).toBe(BLOCK);
        }
        expect(await get(1)).toBe(BLOCK);
        expect(cursorIn(1)).toEqual({ shape: "block", blinking: true });
    });

    it("unset everywhere, the getter has no style and the terminal keeps its own shape", async () => {
        const { cursorIn, get } = await setup({});
        expect(await get(1)).toBeUndefined();
        expect(cursorIn(1)).toBeNull();
    });

    it("the override outlives a settings change; the other editor follows the setting", async () => {
        const { configuration, cursorIn, set, get } = await setup({ "editor.cursorStyle": "line" });
        await set(2, BLOCK);

        await configuration.updateValue("editor.cursorStyle", "underline");
        await settle();

        expect(cursorIn(1)).toEqual({ shape: "underline", blinking: true });
        expect(cursorIn(2)).toEqual({ shape: "block", blinking: true });
        expect(await get(1)).toBe(UNDERLINE);
        expect(await get(2)).toBe(BLOCK);
    });

    it("the blinking still comes from editor.cursorBlinking", async () => {
        const { cursorIn, set } = await setup({ "editor.cursorBlinking": "solid" });
        await set(1, UNDERLINE);
        expect(cursorIn(1)).toEqual({ shape: "underline", blinking: false });
    });

    it("closing the editor drops the override: the reopened file follows the setting again", async () => {
        const { h, pane, cursorIn, set, get } = await setup({ "editor.cursorStyle": "line" });
        await set(1, BLOCK);
        expect(cursorIn(1)).toEqual({ shape: "block", blinking: true });

        const first = h.group.editorGroups.groups[0];
        const main = pane(1);
        const mainPath = main.uri.fsPath;
        h.group.editorGroups.focusGroup({ index: 0 });
        h.group.openFile(h.writeFile("other.ts", "const b = 2;\n"), { preview: false });
        expect(await h.group.closeEditor(first, main)).toBe(true);
        expect(first.getPanes()).not.toContain(main);
        await settle();
        h.group.editorGroups.focusGroup({ index: 0 });
        h.group.openFile(mainPath);
        await settle();

        const reopened = first
            .getPanes()
            .find((candidate) => candidate instanceof TextEditorPane && candidate.uri.fsPath === mainPath);
        expect(reopened).toBeInstanceOf(TextEditorPane);
        (reopened as TextEditorPane).focusEditor();
        h.app.render();
        expect(h.app.backend.cursorStyle).toEqual({ shape: "bar", blinking: true });
        expect(await get(1)).toBe(LINE);
    });
});
