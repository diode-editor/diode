import { afterEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

const LINE_COUNT = 500;
const CONTENT = Array.from({ length: LINE_COUNT }, (_, i) => `row-${String(i)}.`).join("\n");

/** `TextEditor.revealRange` (#963) through the real subprocess, read off the frame. */
describe("ExtensionHost — TextEditor.revealRange", () => {
    let harness: IExtensionHarness | undefined;

    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
    });

    async function setup() {
        const h = await createExtensionTestHarness({
            initialFile: { name: "main.txt", content: CONTENT },
            extensions: [extensionFixture("test.reveal", "revealRangeExtension.cjs")],
        });
        harness = h;
        const pane = (column: number): TextEditorPane => {
            const found = h.group.editorGroups.groups[column - 1].getPane(0);
            expect(found).toBeInstanceOf(TextEditorPane);
            return found as TextEditorPane;
        };
        /** Document lines on screen, top to bottom. */
        const rowsOf = (app: TestApp): number[] => {
            app.render();
            const matches = app.backend.screenToString().matchAll(/row-(\d+)\./g);
            return Array.from(matches, (match) => Number(match[1]));
        };
        const reveal = async (line: number, type?: string, endLine?: number, column = 1): Promise<void> => {
            await h.commandRegistry.execute("test.reveal.range", column, line, type, endLine);
            await settle();
        };
        return { h, pane, rows: () => rowsOf(h.app), rowsOf, reveal };
    }

    it("[api:TextEditorRevealType] carries upstream's values", async () => {
        const { h } = await setup();
        expect(await h.commandRegistry.execute("test.reveal.enum")).toMatchObject({
            Default: 0,
            InCenter: 1,
            InCenterIfOutsideViewport: 2,
            AtTop: 3,
        });
    });

    it("[api:TextEditor.revealRange] [api:TextEditorRevealType] Default scrolls as little as possible, and not at all for a visible range", async () => {
        const { rows, reveal } = await setup();
        const first = rows();
        expect(first[0]).toBe(0);

        await reveal(first.at(-1) ?? -1);
        expect(rows()).toEqual(first);

        await reveal(200);
        expect(rows().at(-1)).toBe(200);

        await reveal(150, "Default");
        expect(rows()[0]).toBe(150);
    });

    it("[api:TextEditor.revealRange] [api:TextEditorRevealType] InCenter centers a range that is already visible", async () => {
        const { rows, reveal } = await setup();
        const height = rows().length;
        await reveal(100, "AtTop");
        await reveal(103, "InCenter");

        const shown = rows();
        expect(shown[Math.floor(height / 2)]).toBe(103);
        expect(shown[0]).toBe(103 - Math.floor(height / 2));
    });

    it("[api:TextEditor.revealRange] [api:TextEditorRevealType] InCenterIfOutsideViewport centers only what was outside", async () => {
        const { rows, reveal } = await setup();
        const height = rows().length;
        await reveal(100, "AtTop");
        const before = rows();

        await reveal(103, "InCenterIfOutsideViewport");
        expect(rows()).toEqual(before);

        await reveal(300, "InCenterIfOutsideViewport");
        expect(rows()[Math.floor(height / 2)]).toBe(300);
    });

    it("[api:TextEditor.revealRange] [api:TextEditorRevealType] AtTop puts the start of the range on the top row", async () => {
        const { rows, reveal } = await setup();
        rows();
        await reveal(250, "AtTop");
        expect(rows()[0]).toBe(250);

        await reveal(252, "AtTop");
        expect(rows()[0]).toBe(252);

        await reveal(260, "AtTop", 262);
        expect(rows()[0]).toBe(260);
    });

    it("[api:TextEditor.revealRange] leaves selection and focus alone", async () => {
        const { h, pane, rows, reveal } = await setup();
        rows();
        pane(1).viewState.goToPosition(2, 1);
        const selections = pane(1).viewState.selections;

        await reveal(300, "AtTop");

        expect(rows()[0]).toBe(300);
        expect(pane(1).viewState.selections).toEqual(selections);
        expect(h.group.getActiveTabEditor()).toBe(pane(1));
    });

    it("[api:TextEditor.revealRange] a range past the end stops at the end of the document", async () => {
        const { rows, reveal } = await setup();
        const height = rows().length;

        await reveal(LINE_COUNT + 1000, "AtTop");

        const shown = rows();
        expect(shown.at(-1)).toBe(LINE_COUNT - 1);
        expect(shown).toHaveLength(height);
    });

    it("[api:TextEditor.revealRange] an editor in an inactive group scrolls in its own group", async () => {
        const { h, pane, rowsOf, reveal } = await setup();
        h.group.splitActiveGroup();
        await settle();
        const first = h.app;
        const second = TestApp.createWithContent(pane(2).view);
        rowsOf(first);
        rowsOf(second);
        h.group.editorGroups.focusGroup({ index: 1 });
        const active = h.group.editorGroups.activeGroup;

        await reveal(200, "AtTop", undefined, 1);

        expect(rowsOf(first)[0]).toBe(200);
        expect(rowsOf(second)[0]).toBe(0);
        expect(h.group.editorGroups.activeGroup).toBe(active);
    });

    it("[api:TextEditor.options] reads the editor's resolved indentation and follows its change, per editor", async () => {
        const { h, pane } = await setup();
        const indent = async (column: number): Promise<unknown> =>
            h.commandRegistry.execute("test.reveal.indent", column);
        const seeded = pane(1).viewState;
        expect(await indent(1)).toEqual({ tabSize: seeded.tabSize, insertSpaces: seeded.insertSpaces });

        h.group.splitActiveGroup();
        await settle();
        pane(1).setIndentOptions({ tabSize: 7, insertSpaces: true });
        pane(2).setIndentOptions({ tabSize: 3, insertSpaces: false });
        await settle();

        expect(await indent(1)).toEqual({ tabSize: 7, insertSpaces: true });
        expect(await indent(2)).toEqual({ tabSize: 3, insertSpaces: false });
    });

    it("[api:TextEditor.revealRange] on a closed editor does not throw and scrolls nothing", async () => {
        const { h, pane, rowsOf, reveal } = await setup();
        h.group.splitActiveGroup();
        await settle();
        const second = TestApp.createWithContent(pane(2).view);
        rowsOf(second);
        await h.commandRegistry.execute("test.reveal.hold", 1);
        await h.group.closeEditor(h.group.editorGroups.groups[0], 0);
        await settle();

        expect(await h.commandRegistry.execute("test.reveal.onHeld")).toBe("no throw");
        await settle();

        expect(rowsOf(second)[0]).toBe(0);
        // The session is alive: the surviving editor still reveals.
        await reveal(50, "AtTop");
        expect(rowsOf(second)[0]).toBe(50);
    });
});
