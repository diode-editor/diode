import { afterEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

/**
 * Enter bound to an extension command, the next key arriving before the extension answers (#967): a fast typist on
 * the first Enter after startup, or any key that comes in one chunk with Enter over ssh. The line break must survive,
 * with the key after it, in the order they were pressed.
 */
describe("ExtensionHost — a key right after an Enter handled by an extension", () => {
    let harness: IExtensionHarness | undefined;

    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
    });

    async function setup(content: string, line: number, character: number) {
        const h = await createExtensionTestHarness({
            initialFile: { name: "main.txt", content },
            extensions: [extensionFixture("test.snippet", "insertSnippetExtension.cjs")],
        });
        harness = h;
        const pane = h.group.editorGroups.groups[0].getPane(0);
        expect(pane).toBeInstanceOf(TextEditorPane);
        const editor = pane as TextEditorPane;
        editor.focusEditor();
        editor.viewState.selections = [
            { anchor: { line, character }, active: { line, character }, idealColumn: undefined },
        ];
        await settle();
        return { h, text: (): string => editor.model.document.getText() };
    }

    it("the key lands after the extension's edit once the extension has answered", async () => {
        const { h, text } = await setup("def f():\n", 0, 8);

        await h.commandRegistry.execute("test.snippet.editEnter");
        await settle();
        h.app.sendKey("z");
        await settle();

        expect(text()).toBe("def f():\n    z\n");
    });

    it("[api:TextEditor.edit] the line break of an edit survives a key that beat the answer", async () => {
        const { h, text } = await setup("def f():\n", 0, 8);

        const enter = h.commandRegistry.execute("test.snippet.editEnter");
        h.app.sendKey("z");
        await enter;
        await settle();

        expect(text()).toBe("def f():\n    z\n");
    });

    it("[api:TextEditor.insertSnippet] the line break of a snippet survives a key that beat the answer", async () => {
        const { h, text } = await setup("    foo()\n", 0, 8);

        const enter = h.commandRegistry.execute("test.snippet.enter");
        h.app.sendKey("z");
        await enter;
        await settle();

        expect(text()).toBe("    foo(\n        z\n    )\n");
    });
});
