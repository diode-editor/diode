import type { TerminalMouseEventData } from "@tuidom/core/common/iTerminalSurface";
import { afterEach, describe, expect, it, vi } from "vitest";

import { emulatorWith } from "../../../../../../TestUtils/terminalLinks.ts";
import { terminalConfiguration } from "../../../../common/configuration/terminalConfiguration.ts";
import type { ExtensionPtySession } from "../../../terminal/node/extensionPtySession.ts";

import { TerminalSelectionSurface } from "./terminalSelectionSurface.ts";

const SEPARATORS = terminalConfiguration.properties["terminal.integrated.wordSeparators"].default;

function mouse(
    col: number,
    row: number,
    action: TerminalMouseEventData["action"],
    { button = "left", ctrl = false, shift = false, detail }: Partial<TerminalMouseEventData> = {},
): TerminalMouseEventData {
    return { col, row, action, button, ctrl, alt: false, shift, ...(detail === undefined ? {} : { detail }) };
}

describe("TerminalSelectionSurface: double and triple click, Shift+click", () => {
    let session: ExtensionPtySession;
    let surface: TerminalSelectionSurface;
    let separators: string;
    let finished: number;

    async function setup(output: string, cols = 20, rows = 4): Promise<void> {
        session = await emulatorWith(output, cols, rows);
        separators = SEPARATORS;
        surface = new TerminalSelectionSurface(session, () => separators);
        finished = 0;
        surface.onDidFinishSelection(() => {
            finished++;
        });
    }

    afterEach(() => {
        session.dispose();
    });

    /** The press and release of the `clicks`-th click of a series on one cell. */
    function click(col: number, row: number, clicks: number, modifiers: Partial<TerminalMouseEventData> = {}): void {
        surface.sendMouse(mouse(col, row, "down", { ...modifiers, detail: clicks }));
        surface.sendMouse(mouse(col, row, "up", { ...modifiers, detail: clicks }));
    }

    function doubleClick(col: number, row: number, modifiers: Partial<TerminalMouseEventData> = {}): void {
        click(col, row, 1, modifiers);
        click(col, row, 2, modifiers);
    }

    function tripleClick(col: number, row: number): void {
        doubleClick(col, row);
        click(col, row, 3);
    }

    /** The press of the `clicks`-th click, a drag through the points, the release at the last one. */
    function clickDrag(clicks: number, from: [number, number], ...to: [number, number][]): void {
        for (let i = 1; i < clicks; i++) click(from[0], from[1], i);
        surface.sendMouse(mouse(from[0], from[1], "down", { detail: clicks }));
        for (const [col, row] of to) surface.sendMouse(mouse(col, row, "move", { button: "none" }));
        const last = to.at(-1) ?? from;
        surface.sendMouse(mouse(last[0], last[1], "up", { detail: clicks }));
    }

    describe("double click", () => {
        it("selects the word under the pointer, up to the separators", async () => {
            await setup("echo some/path/file.ts other");

            doubleClick(12, 0);

            expect(surface.selectionText).toBe("some/path/file.ts");
        });

        it("on a separator selects only it; on the blank right of the text, nothing", async () => {
            await setup("ab (cd) ef");

            doubleClick(3, 0);
            expect(surface.selectionText).toBe("(");

            // The space alone: its text is trimmed as any trailing blank is.
            doubleClick(2, 0);
            expect(surface.hasSelection).toBe(true);
            expect(surface.selectionText).toBe("");

            doubleClick(15, 0);
            expect(surface.hasSelection).toBe(false);
        });

        it("takes the separators from the setting on every double click", async () => {
            await setup("echo some/path/file.ts other");

            separators = `${SEPARATORS}/`;
            doubleClick(12, 0);
            expect(surface.selectionText).toBe("path");

            separators = SEPARATORS;
            doubleClick(12, 0);
            expect(surface.selectionText).toBe("some/path/file.ts");
        });

        it("then a drag grows the selection by whole words, either way", async () => {
            await setup("one two three four");

            clickDrag(2, [5, 0], [9, 0]);
            expect(surface.selectionText).toBe("two three");

            clickDrag(2, [9, 0], [1, 0]);
            expect(surface.selectionText).toBe("one two three");

            // Back inside the anchor word: the word stays.
            clickDrag(2, [9, 0], [16, 0], [10, 0]);
            expect(surface.selectionText).toBe("three");
        });

        it("where no word is, a drag selects by cells", async () => {
            await setup("ab");

            clickDrag(2, [6, 0], [1, 0]);

            expect(surface.selectionText).toBe("b");
        });

        it("with Ctrl is a link's: no word", async () => {
            await setup("echo some/path/file.ts other");

            doubleClick(12, 0, { ctrl: true });

            expect(surface.hasSelection).toBe(false);
        });
    });

    describe("triple click", () => {
        it("selects the line with all its soft-wrapped rows", async () => {
            await setup("$ ls\r\n0123456789abcdefghij0123\r\ndone", 10, 6);

            tripleClick(3, 2);

            expect(surface.selectionText).toBe("0123456789abcdefghij0123");
        });

        it("then a drag grows the selection by whole lines, either way", async () => {
            await setup("one\r\ntwo\r\nthree\r\nfour", 10, 5);

            clickDrag(3, [1, 1], [0, 2]);
            expect(surface.selectionText).toBe("two\nthree");

            clickDrag(3, [1, 2], [2, 0]);
            expect(surface.selectionText).toBe("one\ntwo\nthree");
        });

        it("a fourth click in a row keeps the line", async () => {
            await setup("one two");

            tripleClick(1, 0);
            click(1, 0, 4);

            expect(surface.selectionText).toBe("one two");
        });
    });

    describe("Shift+click", () => {
        it("moves the end of the selection from its anchor, growing or shrinking it", async () => {
            await setup("hello world again");
            clickDrag(1, [2, 0], [4, 0]);

            click(10, 0, 1, { shift: true });
            expect(surface.selectionText).toBe("llo world");

            click(3, 0, 1, { shift: true });
            expect(surface.selectionText).toBe("ll");

            click(0, 0, 1, { shift: true });
            expect(surface.selectionText).toBe("hel");
        });

        it("keeps a double-clicked word whole as its anchor", async () => {
            await setup("hello world again");
            doubleClick(8, 0);

            click(14, 0, 1, { shift: true });
            expect(surface.selectionText).toBe("world aga");

            click(1, 0, 1, { shift: true });
            expect(surface.selectionText).toBe("ello world");
        });

        it("then a drag moves the end on", async () => {
            await setup("hello world again");
            clickDrag(1, [0, 0], [1, 0]);

            surface.sendMouse(mouse(4, 0, "down", { shift: true, detail: 1 }));
            surface.sendMouse(mouse(7, 0, "move", { button: "none", shift: true }));
            surface.sendMouse(mouse(7, 0, "up", { shift: true, detail: 1 }));

            expect(surface.selectionText).toBe("hello wo");
        });

        it("without a selection is a plain click", async () => {
            await setup("hello world");

            click(3, 0, 1, { shift: true });
            expect(surface.hasSelection).toBe(false);

            surface.sendMouse(mouse(3, 0, "down", { shift: true, detail: 1 }));
            surface.sendMouse(mouse(5, 0, "move", { button: "none", shift: true }));
            surface.sendMouse(mouse(5, 0, "up", { shift: true, detail: 1 }));
            expect(surface.selectionText).toBe("lo");
        });
    });

    describe("a program tracking the mouse", () => {
        it("gets the double and triple clicks, their count included", async () => {
            await setup("hello world\x1b[?1002h");
            const forwarded = vi.spyOn(session, "sendMouse");

            tripleClick(2, 0);

            expect(surface.hasSelection).toBe(false);
            expect(forwarded.mock.calls.map(([event]) => [event.action, event.detail])).toEqual([
                ["down", 1],
                ["up", 1],
                ["down", 2],
                ["up", 2],
                ["down", 3],
                ["up", 3],
            ]);
        });

        it("with Shift, a double click selects the word and a triple click the line; Shift+click starts over", async () => {
            await setup("hello world\x1b[?1002h");
            const forwarded = vi.spyOn(session, "sendMouse");

            doubleClick(8, 0, { shift: true });
            expect(surface.selectionText).toBe("world");

            click(8, 0, 3, { shift: true });
            expect(surface.selectionText).toBe("hello world");

            click(1, 0, 1, { shift: true });
            expect(surface.hasSelection).toBe(false);
            expect(forwarded).not.toHaveBeenCalled();
        });
    });

    describe("the finished selection (copy on selection)", () => {
        it("is reported once per gesture: on the release of a drag, not on its steps", async () => {
            await setup("hello world");

            surface.sendMouse(mouse(0, 0, "down", { detail: 1 }));
            surface.sendMouse(mouse(2, 0, "move", { button: "none" }));
            surface.sendMouse(mouse(4, 0, "move", { button: "none" }));
            expect(finished).toBe(0);

            surface.sendMouse(mouse(4, 0, "up", { detail: 1 }));
            expect(finished).toBe(1);
        });

        it("is reported by a double click, a triple click, Shift+click and Select All", async () => {
            await setup("hello world");

            doubleClick(1, 0);
            expect(finished).toBe(1);
            click(1, 0, 3);
            expect(finished).toBe(2);
            click(8, 0, 1, { shift: true });
            expect(finished).toBe(3);
            surface.selectAll();
            expect(finished).toBe(4);
        });

        it("is not reported by a click that clears the selection or selects nothing", async () => {
            await setup("hello world");
            doubleClick(1, 0);
            finished = 0;

            click(3, 0, 1);
            doubleClick(15, 0);

            expect(surface.hasSelection).toBe(false);
            expect(finished).toBe(0);
        });
    });
});
