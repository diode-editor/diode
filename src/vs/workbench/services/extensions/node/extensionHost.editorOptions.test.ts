import { afterEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import type { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

const LINE = 1;
const BLOCK = 2;

/**
 * `window.onDidChangeTextEditorOptions` and `TextEditor.options` (#1231) through the real subprocess: the core reports
 * the options of each visible editor when they change, and an assignment lands on the editor it was made on.
 */
describe("ExtensionHost — window.onDidChangeTextEditorOptions", () => {
    let harness: IExtensionHarness | undefined;

    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
    });

    /** Two groups with `main.ts` each, the second one active. */
    async function setup() {
        const configuration: InMemoryConfigurationService = createTestConfigurationService({
            "editor.tabSize": 4,
            "editor.insertSpaces": true,
        });
        const h = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "const a = 1;\n" },
            extensions: [extensionFixture("test.options", "editorOptionsExtension.cjs")],
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
        const take = async (): Promise<unknown> => {
            await settle();
            return h.commandRegistry.execute("test.options.take");
        };
        await take();
        return { h, configuration, pane, take };
    }

    it("[api:window.onDidChangeTextEditorOptions] an indentation change of one editor fires for that editor only", async () => {
        const { pane, take } = await setup();

        pane(1).setIndentOptions({ tabSize: 2, insertSpaces: false });

        expect(await take()).toEqual([
            {
                viewColumn: 1,
                options: { tabSize: 2, indentSize: 2, insertSpaces: false, cursorStyle: LINE, lineNumbers: 1 },
            },
        ]);
    });

    it("[api:window.onDidChangeTextEditorOptions] editor.cursorStyle in the settings fires for every visible editor", async () => {
        const { configuration, take } = await setup();

        await configuration.updateValue("editor.cursorStyle", "block");

        const events = (await take()) as { viewColumn: number; options: { cursorStyle: number } }[];
        expect(events.map((e) => [e.viewColumn, e.options.cursorStyle]).sort()).toEqual([
            [1, BLOCK],
            [2, BLOCK],
        ]);
    });

    it("[api:TextEditor.options] options = { tabSize: 2 } on the editor that is not active changes that editor only", async () => {
        const { h, pane, take } = await setup();
        expect(h.group.editorGroups.activeGroup).toBe(h.group.editorGroups.groups[1]);

        await h.commandRegistry.execute("test.options.set", 1, { tabSize: 2 });

        expect(await take()).toEqual([
            {
                viewColumn: 1,
                options: { tabSize: 2, indentSize: 2, insertSpaces: true, cursorStyle: LINE, lineNumbers: 1 },
            },
        ]);
        expect(pane(1).viewState.tabSize).toBe(2);
        expect(pane(2).viewState.tabSize).toBe(4);
        expect(await h.commandRegistry.execute("test.options.get", 2)).toMatchObject({ tabSize: 4 });
    });

    it("[api:TextEditor.options] an assigned lineNumbers reads as the editor's, not as assigned", async () => {
        const { h } = await setup();
        await h.commandRegistry.execute("test.options.set", 1, { lineNumbers: 2 });
        expect(await h.commandRegistry.execute("test.options.get", 1)).toMatchObject({ lineNumbers: 1 });
    });
});
