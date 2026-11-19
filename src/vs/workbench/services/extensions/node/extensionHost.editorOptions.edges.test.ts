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

interface IRecorded {
    viewColumn: number;
    options: Record<string, unknown>;
    getter: Record<string, unknown>;
}

/** Edges of `window.onDidChangeTextEditorOptions` and `TextEditor.options` (#1231) through the real subprocess. */
describe("ExtensionHost — editor options edges", () => {
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
            extensions: [extensionFixture("test.optionsEdges", "editorOptionsEdgesExtension.cjs")],
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
        const take = async (): Promise<IRecorded[]> => {
            await settle();
            await settle();
            return (await h.commandRegistry.execute("test.optionsEdges.take")) as IRecorded[];
        };
        await take();
        return { h, configuration, pane, take };
    }

    it("[api:TextEditor.options] assigning the value the editor already has fires nothing", async () => {
        const { h, take } = await setup();
        await h.commandRegistry.execute("test.optionsEdges.setMany", 1, [{ tabSize: 4, insertSpaces: true }]);
        expect(await take()).toEqual([]);
    });

    it("[api:window.onDidChangeTextEditorOptions] an unrelated setting or the same value again fires nothing", async () => {
        const { configuration, take } = await setup();
        await configuration.updateValue("editor.fontSize", 20);
        await configuration.updateValue("editor.tabSize", 4);
        expect(await take()).toEqual([]);
    });

    it("[api:TextEditor.options] the getter reads the assigned value at once, before the core answers", async () => {
        const { h } = await setup();
        const read = await h.commandRegistry.execute("test.optionsEdges.setAndGet", 1, {
            tabSize: 2,
            insertSpaces: false,
        });
        expect(read).toMatchObject({ tabSize: 2, insertSpaces: false });
    });

    it("[api:TextEditor.options] 'auto' reads back as a number and a boolean", async () => {
        const { h, take } = await setup();
        await h.commandRegistry.execute("test.optionsEdges.setMany", 1, [{ tabSize: "auto", insertSpaces: "auto" }]);
        await take();
        const read = (await h.commandRegistry.execute("test.optionsEdges.get", 1)) as Record<string, unknown>;
        expect(typeof read.tabSize).toBe("number");
        expect(typeof read.insertSpaces).toBe("boolean");
    });

    it("[api:TextEditor.options] indentSize assigned changes the tab size with one event", async () => {
        const { h, pane, take } = await setup();
        await h.commandRegistry.execute("test.optionsEdges.setMany", 1, [{ indentSize: 3 }]);
        const events = await take();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ viewColumn: 1, options: { tabSize: 3, indentSize: 3 } });
        expect(pane(1).viewState.tabSize).toBe(3);
    });

    it("[api:TextEditor.options] cursorStyle assigned to the inactive editor fires for that editor only", async () => {
        const { h, take } = await setup();
        await h.commandRegistry.execute("test.optionsEdges.setMany", 1, [{ cursorStyle: BLOCK }]);
        const events = await take();
        expect(events.map((e) => [e.viewColumn, e.options.cursorStyle])).toEqual([[1, BLOCK]]);
        expect(await h.commandRegistry.execute("test.optionsEdges.get", 2)).toMatchObject({ cursorStyle: LINE });
    });

    it("[api:window.onDidChangeTextEditorOptions] editor.insertSpaces in the settings fires for both editors", async () => {
        const { configuration, pane, take } = await setup();
        await configuration.updateValue("editor.insertSpaces", false);
        const events = await take();
        expect(events.map((e) => [e.viewColumn, e.options.insertSpaces]).sort()).toEqual([
            [1, false],
            [2, false],
        ]);
        expect(pane(1).viewState.insertSpaces).toBe(false);
    });

    it("[api:TextEditor.options] a newly opened tab-indented file reads its detected indentation", async () => {
        const { h } = await setup();
        const file = h.writeFile("tabs.ts", "function f() {\n\treturn 1;\n}\nfunction g() {\n\treturn 2;\n}\n");
        h.group.openFile(file);
        await settle();
        await settle();
        await h.flushRpc();
        const active = h.group.editorGroups.activeGroup.activePane as TextEditorPane;
        expect(active.viewState.insertSpaces).toBe(false);
        expect(await h.commandRegistry.execute("test.optionsEdges.activeGet")).toMatchObject({ insertSpaces: false });
    });

    it("[api:TextEditor.options] quick assignments in one tick settle on the last one everywhere", async () => {
        const { h, pane, take } = await setup();
        await h.commandRegistry.execute("test.optionsEdges.setMany", 1, [
            { tabSize: 2 },
            { tabSize: 3 },
            { tabSize: 2 },
        ]);
        const events = await take();
        expect(pane(1).viewState.tabSize).toBe(2);
        expect(await h.commandRegistry.execute("test.optionsEdges.get", 1)).toMatchObject({ tabSize: 2 });
        if (events.length > 0) expect(events.at(-1)?.options.tabSize).toBe(2);
    });

    it("[api:window.onDidChangeTextEditorOptions] the getter inside the handler holds the event's values", async () => {
        const { h, configuration, take } = await setup();
        await configuration.updateValue("editor.tabSize", 6);
        await h.commandRegistry.execute("test.optionsEdges.setMany", 1, [{ cursorStyle: BLOCK }]);
        const events = await take();
        expect(events.length).toBeGreaterThan(0);
        for (const e of events) expect(e.getter).toEqual(e.options);
    });
});
