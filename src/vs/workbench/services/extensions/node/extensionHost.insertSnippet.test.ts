import { afterEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

/** `TextEditor.insertSnippet` (#967) through the real subprocess: no session, text and caret only. */
describe("ExtensionHost — TextEditor.insertSnippet", () => {
    let harness: IExtensionHarness | undefined;

    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
    });

    async function setup(content: string) {
        const h = await createExtensionTestHarness({
            initialFile: { name: "main.txt", content },
            extensions: [extensionFixture("test.snippet", "insertSnippetExtension.cjs")],
        });
        harness = h;
        const pane = h.group.editorGroups.groups[0].getPane(0);
        expect(pane).toBeInstanceOf(TextEditorPane);
        const editor = pane as TextEditorPane;
        const text = (): string => editor.model.document.getText();
        const caret = (): unknown => editor.viewState.selections[0].active;
        const putCaret = (line: number, character: number): void => {
            editor.viewState.selections = [
                { anchor: { line, character }, active: { line, character }, idealColumn: undefined },
            ];
        };
        const frame = (): string => {
            h.app.render();
            return h.app.backend.screenToString();
        };
        return { h, editor, text, caret, putCaret, frame };
    }

    it("[api:TextEditor.insertSnippet] a command that does not await it gets the line break, the indent and the caret", async () => {
        const { h, text, caret, putCaret, frame } = await setup("    foo()\n");
        putCaret(0, 8);
        await settle();

        await h.commandRegistry.execute("test.snippet.enter");
        await settle();

        expect(text()).toBe("    foo(\n        \n    )\n");
        expect(caret()).toEqual({ line: 1, character: 8 });
        expect(frame()).toMatch(/foo\(\s*\n[^\n]*2\s/);
    });

    it("[api:TextEditor.insertSnippet] undo removes the whole insertion in one step", async () => {
        const { h, editor, text, putCaret } = await setup("    foo()\n");
        putCaret(0, 8);
        await settle();

        await h.commandRegistry.execute("test.snippet.enter");
        await settle();
        expect(text()).toBe("    foo(\n        \n    )\n");

        editor.undo();
        await settle();
        expect(text()).toBe("    foo()\n");
    });

    it("[api:TextEditor.insertSnippet] a placeholder comes out selected, and the promise says it went in", async () => {
        const { h, editor, text, putCaret } = await setup("ab\n");
        putCaret(0, 1);
        await settle();

        const inserted = await h.commandRegistry.execute("test.snippet.insert", "<${1:name}>");
        await settle();

        expect(inserted).toBe(true);
        expect(text()).toBe("a<name>b\n");
        expect(editor.viewState.selections[0]).toMatchObject({
            anchor: { line: 0, character: 2 },
            active: { line: 0, character: 6 },
        });
    });

    it("[api:TextEditor.insertSnippet] several locations get a caret each, on one line and across lines", async () => {
        const { h, editor, text } = await setup("ab\ncd\n");
        await settle();

        const location = [
            [0, 1],
            [0, 2],
            [1, 0],
        ];
        await h.commandRegistry.execute("test.snippet.insert", "x\n$0y", location);
        await settle();

        expect(text()).toBe("ax\nybx\ny\nx\nycd\n");
        expect(editor.viewState.selections.map((selection) => selection.active)).toEqual([
            { line: 1, character: 0 },
            { line: 2, character: 0 },
            { line: 4, character: 0 },
        ]);
    });

    it("[api:TextEditor.insertSnippet] keepWhitespace leaves the template's whitespace alone", async () => {
        const { h, text, putCaret } = await setup("    a\n");
        putCaret(0, 5);
        await settle();

        await h.commandRegistry.execute("test.snippet.insert", "\nb", undefined, {
            undoStopBefore: true,
            undoStopAfter: true,
            keepWhitespace: true,
        });
        await settle();

        expect(text()).toBe("    a\nb\n");
    });

    it("[api:TextEditor.insertSnippet] replaces the selection when no location is given", async () => {
        const { h, editor, text } = await setup("abcd\n");
        editor.viewState.selections = [
            { anchor: { line: 0, character: 1 }, active: { line: 0, character: 3 }, idealColumn: undefined },
        ];
        await settle();

        await h.commandRegistry.execute("test.snippet.insert", "X");
        await settle();

        expect(text()).toBe("aXd\n");
    });

    it("[api:TextEditor.insertSnippet] a closed editor rejects with upstream's message", async () => {
        const { h } = await setup("a\n");
        await settle();
        await h.commandRegistry.execute("test.snippet.hold");

        await h.group.closeEditor(h.group.editorGroups.groups[0], 0);
        await settle();

        await expect(h.commandRegistry.execute("test.snippet.onHeld")).resolves.toBe(
            "TextEditor#insertSnippet not possible on closed editors",
        );
    });
});
