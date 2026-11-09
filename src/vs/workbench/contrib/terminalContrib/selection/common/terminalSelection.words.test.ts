import { afterEach, describe, expect, it } from "vitest";

import { emulatorWith } from "../../../../../../TestUtils/terminalLinks.ts";
import { terminalConfiguration } from "../../../../common/configuration/terminalConfiguration.ts";
import type { ITerminalBuffer } from "../../../terminal/common/terminalBuffer.ts";
import type { ExtensionPtySession } from "../../../terminal/node/extensionPtySession.ts";

import { lineRangeAt, selectionText, wordRangeAt } from "./terminalSelection.ts";

const SEPARATORS = terminalConfiguration.properties["terminal.integrated.wordSeparators"].default;

describe("terminal selection: words and lines", () => {
    let session: ExtensionPtySession | undefined;

    afterEach(() => {
        session?.dispose();
        session = undefined;
    });

    async function bufferWith(output: string, cols = 10, rows = 5): Promise<ITerminalBuffer> {
        session = await emulatorWith(output, cols, rows);
        return session.buffer!;
    }

    function word(buffer: ITerminalBuffer, x: number, y: number, separators: string = SEPARATORS): string | undefined {
        const range = wordRangeAt(buffer, { x, y }, separators);
        return range === undefined ? undefined : selectionText(buffer, range);
    }

    it("a word runs to the nearest separators or the edges of the line", async () => {
        const buffer = await bufferWith("ab (cd) ef");

        expect(word(buffer, 0, 0)).toBe("ab");
        expect(word(buffer, 1, 0)).toBe("ab");
        expect(word(buffer, 5, 0)).toBe("cd");
        expect(word(buffer, 9, 0)).toBe("ef");
        expect(wordRangeAt(buffer, { x: 4, y: 0 }, SEPARATORS)).toEqual({ start: { x: 4, y: 0 }, end: { x: 5, y: 0 } });
    });

    it("the separators come from the setting: a path is one word by default, its parts with `/` added", async () => {
        const buffer = await bufferWith("a/bc/d.ts", 20);

        expect(word(buffer, 3, 0)).toBe("a/bc/d.ts");
        expect(word(buffer, 3, 0, `${SEPARATORS}/`)).toBe("bc");
        expect(word(buffer, 6, 0, `${SEPARATORS}/`)).toBe("d.ts");
    });

    it("a separator is a word of its own", async () => {
        const buffer = await bufferWith("ab (cd) ef");

        expect(wordRangeAt(buffer, { x: 2, y: 0 }, SEPARATORS)).toEqual({ start: { x: 2, y: 0 }, end: { x: 2, y: 0 } });
        expect(word(buffer, 3, 0)).toBe("(");
    });

    it("a cell nothing was written to has no word: right of the text, or past the buffer", async () => {
        const buffer = await bufferWith("ab");

        expect(wordRangeAt(buffer, { x: 5, y: 0 }, SEPARATORS)).toBeUndefined();
        expect(wordRangeAt(buffer, { x: 0, y: 3 }, SEPARATORS)).toBeUndefined();
        expect(wordRangeAt(buffer, { x: 0, y: 99 }, SEPARATORS)).toBeUndefined();
        expect(wordRangeAt(buffer, { x: 99, y: 0 }, SEPARATORS)).toBeUndefined();
    });

    it("a gap a tab left ends a word", async () => {
        const buffer = await bufferWith("ab\tcd", 20);

        expect(word(buffer, 0, 0)).toBe("ab");
        expect(word(buffer, 8, 0)).toBe("cd");
        expect(wordRangeAt(buffer, { x: 4, y: 0 }, SEPARATORS)).toBeUndefined();
    });

    it("a word a soft wrap split is one word, from either row", async () => {
        const buffer = await bufferWith("12345 abcdefgh xy");

        expect(word(buffer, 7, 0)).toBe("abcdefgh");
        expect(word(buffer, 1, 1)).toBe("abcdefgh");
        expect(wordRangeAt(buffer, { x: 1, y: 1 }, SEPARATORS)).toEqual({ start: { x: 6, y: 0 }, end: { x: 3, y: 1 } });
    });

    it("a hard line break ends a word even with no separator at the edge", async () => {
        const buffer = await bufferWith("0123456789\r\nabc");

        expect(word(buffer, 9, 0)).toBe("0123456789");
        expect(word(buffer, 0, 1)).toBe("abc");
    });

    it("a word at the right edge of the buffer's last row ends there", async () => {
        const buffer = await bufferWith("\r\n\r\n\r\n\r\n0123456789");

        expect(word(buffer, 3, 4)).toBe("0123456789");
    });

    it("a separator or a tab gap at the edge of a wrapped row ends the word before it", async () => {
        const spaced = await bufferWith("123456789 abc");
        expect(word(spaced, 0, 0)).toBe("123456789");
        expect(word(spaced, 1, 1)).toBe("abc");

        const tabbed = await bufferWith("ab\tcdefghijkl");
        expect(word(tabbed, 0, 0)).toBe("ab");
        expect(word(tabbed, 9, 0)).toBe("cdefghijkl");
    });

    it("Cyrillic and CJK are word characters; a wide character is never split", async () => {
        const buffer = await bufferWith("\u043f\u0440\u0438 \u4e2d\u6587a b", 20);

        expect(word(buffer, 1, 0)).toBe("\u043f\u0440\u0438");
        expect(word(buffer, 5, 0)).toBe("\u4e2d\u6587a");
        expect(word(buffer, 6, 0)).toBe("\u4e2d\u6587a");
        expect(wordRangeAt(buffer, { x: 6, y: 0 }, SEPARATORS)).toEqual({ start: { x: 4, y: 0 }, end: { x: 8, y: 0 } });
    });

    it("a word ending in a wide character ends on its right half", async () => {
        const buffer = await bufferWith("a\u4e2d b", 20);

        expect(wordRangeAt(buffer, { x: 0, y: 0 }, SEPARATORS)).toEqual({ start: { x: 0, y: 0 }, end: { x: 2, y: 0 } });
        // A wide separator.
        const wide = await bufferWith("a\u3000b", 20);
        expect(wordRangeAt(wide, { x: 2, y: 0 }, "\u3000")).toEqual({ start: { x: 1, y: 0 }, end: { x: 2, y: 0 } });
    });

    it("a wide character that wrapped past the gap it left stays in its word", async () => {
        const buffer = await bufferWith("12345678a\u4e2db");

        expect(word(buffer, 8, 0)).toBe("12345678a\u4e2db");
        expect(word(buffer, 0, 1)).toBe("12345678a\u4e2db");
        expect(wordRangeAt(buffer, { x: 9, y: 0 }, SEPARATORS)).toBeUndefined();
    });

    it("a line is all the rows a soft wrap split it into, edge to edge", async () => {
        const buffer = await bufferWith("one\r\n0123456789abcdefghijKL\r\nlast");

        expect(lineRangeAt(buffer, 0)).toEqual({ start: { x: 0, y: 0 }, end: { x: 9, y: 0 } });
        for (const y of [1, 2, 3]) {
            expect(lineRangeAt(buffer, y)).toEqual({ start: { x: 0, y: 1 }, end: { x: 9, y: 3 } });
        }
        expect(selectionText(buffer, lineRangeAt(buffer, 2))).toBe("0123456789abcdefghijKL");
        expect(selectionText(buffer, lineRangeAt(buffer, 4))).toBe("last");
        expect(lineRangeAt(buffer, 99)).toEqual({ start: { x: 0, y: 99 }, end: { x: 9, y: 99 } });
    });
});
