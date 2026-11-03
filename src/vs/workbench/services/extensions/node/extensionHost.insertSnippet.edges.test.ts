import { afterEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

type Sel = [anchorLine: number, anchorCharacter: number, activeLine: number, activeCharacter: number];

/**
 * Edges of `TextEditor.insertSnippet` parsed in the core (#1031), checked against upstream 1.127
 * `SnippetSession.createEditsAndSnippetsFromEdits`, `adjustWhitespace` and `SelectionBasedVariableResolver`.
 */
describe("ExtensionHost — TextEditor.insertSnippet, edges", () => {
    let harness: IExtensionHarness | undefined;

    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
    });

    async function setup(content: string, configuration?: Record<string, unknown>) {
        const h = await createExtensionTestHarness({
            initialFile: { name: "main.txt", content },
            extensions: [
                extensionFixture("test.snippet", "insertSnippetExtension.cjs"),
                extensionFixture("test.snippetCommand", "insertSnippetCommandExtension.cjs"),
            ],
            ...(configuration ? { configuration } : {}),
        });
        harness = h;
        const pane = h.group.editorGroups.groups[0].getPane(0);
        expect(pane).toBeInstanceOf(TextEditorPane);
        const editor = pane as TextEditorPane;
        const text = (): string => editor.model.document.getText();
        const select = (...selections: Sel[]): void => {
            editor.viewState.selections = selections.map(([al, ac, l, c]) => ({
                anchor: { line: al, character: ac },
                active: { line: l, character: c },
                idealColumn: undefined,
            }));
        };
        const selections = (): Sel[] =>
            editor.viewState.selections.map((s) => [
                s.anchor.line,
                s.anchor.character,
                s.active.line,
                s.active.character,
            ]);
        const insert = async (template: string, location?: number[][], options?: unknown): Promise<unknown> => {
            await settle();
            const result = await h.commandRegistry.execute("test.snippet.insert", template, location, options);
            await settle();
            return result;
        };
        return { h, editor, text, select, selections, insert };
    }

    it("[api:TextEditor.insertSnippet] $CURSOR_INDEX and $CURSOR_NUMBER follow the caller's order of locations", async () => {
        const t = await setup("abcdef\n");
        await t.insert("[$CURSOR_INDEX$CURSOR_NUMBER]", [
            [0, 5],
            [0, 1],
        ]);
        expect(t.text()).toBe("a[12]bcde[01]f\n");
    });

    it("[api:TextEditor.insertSnippet] each selection gets its own selected text, the placeholder selected in each", async () => {
        const t = await setup("aa bb\n");
        t.select([0, 0, 0, 2], [0, 3, 0, 5]);
        await t.insert("<${1:$TM_SELECTED_TEXT}>");
        expect(t.text()).toBe("<aa> <bb>\n");
        expect(t.selections()).toEqual([
            [0, 1, 0, 3],
            [0, 6, 0, 8],
        ]);
    });

    it("[api:TextEditor.insertSnippet] a multi-line selected text gets the indent of the snippet line it lands on", async () => {
        const t = await setup("    a\n    b\n");
        t.select([0, 4, 1, 5]);
        await t.insert("if:\n\t$TM_SELECTED_TEXT");
        expect(t.text()).toBe("    if:\n        a\n        b\n");
    });

    it("[api:TextEditor.insertSnippet] only top-level text is re-indented, as upstream: placeholder and choice text stay as written", async () => {
        const t = await setup("  x\n");
        await t.insert("${1:a\nb}|${2|c\nd,e|}\nz", [[0, 3]]);
        expect(t.text()).toBe("  xa\nb|c\nd\n  z\n");
    });

    it("[api:TextEditor.insertSnippet] spaces in the template become tabs in a tab-indented editor", async () => {
        const t = await setup("\tx\n", { "editor.insertSpaces": false, "editor.detectIndentation": false });
        await t.insert("{\n    y\n}", [[0, 2]]);
        expect(t.text()).toBe("\tx{\n\t\ty\n\t}\n");
    });

    it("[api:TextEditor.insertSnippet] a CRLF document stays CRLF, the placeholder spans its line break", async () => {
        const t = await setup("a\r\nb\r\n");
        await t.insert("1\n2${1:3\n4}", [[0, 1]]);
        expect(t.text()).toBe("a1\n23\n4\nb\n");
        expect(t.editor.model.document.eol).toBe(EndOfLine.CRLF);
        expect(t.selections()).toEqual([[1, 1, 2, 1]]);
    });

    it("[api:TextEditor.insertSnippet] a lone CR in the template is a line break that gets the indent", async () => {
        const t = await setup("  x\n");
        await t.insert("1\r2", [[0, 3]]);
        expect(t.text()).toBe("  x1\n  2\n");
    });

    it("[api:TextEditor.insertSnippet] the placeholder after an emoji is selected in UTF-16 units", async () => {
        const t = await setup("\n");
        await t.insert("😀${1:é}x", [[0, 0]]);
        expect(t.text()).toBe("😀éx\n");
        expect(t.selections()).toEqual([[0, 2, 0, 3]]);
    });

    it("[api:TextEditor.insertSnippet] undoStopAfter: false then undoStopBefore: false undo together", async () => {
        const t = await setup("\n");
        await t.insert("a", [[0, 0]], { undoStopBefore: true, undoStopAfter: false });
        await t.insert("b", [[0, 1]], { undoStopBefore: false, undoStopAfter: false });
        expect(t.text()).toBe("ab\n");
        t.editor.undo();
        await settle();
        expect(t.text()).toBe("\n");
    });

    it("[api:TextEditor.insertSnippet] an empty template succeeds and changes nothing", async () => {
        const t = await setup("q\n");
        await expect(t.insert("", [[0, 1]])).resolves.toBe(true);
        expect(t.text()).toBe("q\n");
    });

    it("[api:TextEditor.insertSnippet] an unclosed placeholder is literal text, the caret after it", async () => {
        const t = await setup("q\n");
        await t.insert("${1:", [[0, 1]]);
        expect(t.text()).toBe("q${1:\n");
        expect(t.selections()).toEqual([[0, 5, 0, 5]]);
    });

    it("[api:TextEditor.insertSnippet] $0 written first still comes last: $1 is selected", async () => {
        const t = await setup("q\n");
        await t.insert("$0x${1:y}", [[0, 0]]);
        expect(t.text()).toBe("xyq\n");
        expect(t.selections()).toEqual([[0, 1, 0, 2]]);
    });

    it("[api:TextEditor.insertSnippet] the word and line index at a caret on a last line without a line break", async () => {
        const t = await setup("foo bar");
        t.select([0, 5, 0, 5]);
        await t.insert("[$TM_CURRENT_WORD|$TM_LINE_INDEX]");
        expect(t.text()).toBe("foo b[bar|0]ar");
        expect(t.selections()).toEqual([[0, 12, 0, 12]]);
    });

    it("[api:TextEditor.insertSnippet] a transform with the g flag replaces every match; a repeated placeholder is selected twice", async () => {
        const t = await setup("a-b-c\n");
        t.select([0, 0, 0, 5]);
        await t.insert("${TM_SELECTED_TEXT/(-)/_/g}${1:z}${1:z}");
        expect(t.text()).toBe("a_b_czz\n");
        expect(t.selections()).toEqual([
            [0, 5, 0, 6],
            [0, 6, 0, 7],
        ]);
    });

    it("[api:TextEditor.insertSnippet] a 5000-line template goes in whole, the placeholder on its last line", async () => {
        const t = await setup("\n");
        const big = Array.from({ length: 5000 }, (_, i) => `line ${i} \\$x`).join("\n") + "${1:end}";
        await t.insert(big, [[0, 0]]);
        expect(t.text().split("\n")).toHaveLength(5001);
        expect(t.selections()).toEqual([[4999, 12, 4999, 15]]);
    });

    it("[api:commands.executeCommand] editor.action.insertSnippet from an extension selects the placeholder", async () => {
        const t = await setup("ab\n");
        t.select([0, 1, 0, 1]);
        await settle();
        await t.h.commandRegistry.execute("test.snippetCommand.run", { snippet: "<${1:x}>" });
        await settle();
        expect(t.text()).toBe("a<x>b\n");
        expect(t.selections()).toEqual([[0, 2, 0, 3]]);
    });

    it("[api:TextEditor.insertSnippet] a held editor in an inactive group gets the snippet at its own caret", async () => {
        const t = await setup("ab\n");
        t.select([0, 0, 0, 0]);
        await settle();
        await t.h.commandRegistry.execute("test.snippet.hold");
        t.h.group.splitActiveGroup();
        await settle();
        const second = t.h.group.editorGroups.groups[1].getPane(0) as TextEditorPane;
        second.viewState.selections = [
            { anchor: { line: 0, character: 2 }, active: { line: 0, character: 2 }, idealColumn: undefined },
        ];
        t.h.group.editorGroups.focusGroup({ index: 1 });
        await settle();

        await expect(t.h.commandRegistry.execute("test.snippet.onHeld")).resolves.toBe(true);
        await settle();

        expect(t.text()).toBe("xab\n");
        expect(t.selections()).toEqual([[0, 1, 0, 1]]);
    });
});
