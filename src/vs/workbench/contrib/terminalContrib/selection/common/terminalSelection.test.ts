import { afterEach, describe, expect, it } from "vitest";

import { emulatorWith } from "../../../../../../TestUtils/terminalLinks.ts";
import type { ITerminalBuffer } from "../../../terminal/common/terminalBuffer.ts";
import type { ExtensionPtySession } from "../../../terminal/node/extensionPtySession.ts";

import { selectionRange, selectionText } from "./terminalSelection.ts";

describe("terminal selection", () => {
    let session: ExtensionPtySession | undefined;

    afterEach(() => {
        session?.dispose();
        session = undefined;
    });

    async function bufferWith(output: string, cols = 10, rows = 5): Promise<ITerminalBuffer> {
        session = await emulatorWith(output, cols, rows);
        return session.buffer!;
    }

    function text(buffer: ITerminalBuffer, from: [number, number], to: [number, number]): string {
        return selectionText(buffer, selectionRange(buffer, { x: from[0], y: from[1] }, { x: to[0], y: to[1] }));
    }

    it("selects from the press to the pointer either way: the first row to the edge, the last from the start", async () => {
        const buffer = await bufferWith("hello\r\nworld\r\nagain");

        expect(text(buffer, [1, 0], [2, 2])).toBe("ello\nworld\naga");
        expect(text(buffer, [2, 2], [1, 0])).toBe("ello\nworld\naga");
        expect(text(buffer, [3, 1], [1, 1])).toBe("orl");
        expect(text(buffer, [0, 0], [0, 0])).toBe("h");
    });

    it("joins rows a soft wrap split without a line break; a real line feed is one", async () => {
        const buffer = await bufferWith("abcdefghijKLM\r\nnext");

        expect(text(buffer, [8, 0], [1, 2])).toBe("ijKLM\nne");
        expect(text(buffer, [0, 1], [3, 2])).toBe("KLM\nnext");
    });

    it("drops trailing blanks of every line, empty cells and typed spaces alike", async () => {
        const buffer = await bufferWith("a b   \r\n\r\nc");

        expect(text(buffer, [0, 0], [9, 2])).toBe("a b\n\nc");
        // Spaces inside a line stay.
        expect(text(buffer, [0, 0], [2, 0])).toBe("a b");
    });

    it("copies a wide character once; a selection that starts on its right half takes all of it", async () => {
        const buffer = await bufferWith("a中b😀c");

        expect(text(buffer, [0, 0], [6, 0])).toBe("a中b😀c");
        expect(text(buffer, [2, 0], [3, 0])).toBe("中b");
        expect(text(buffer, [3, 0], [2, 0])).toBe("中b");
        expect(text(buffer, [1, 0], [1, 0])).toBe("中");
        expect(selectionRange(buffer, { x: 2, y: 0 }, { x: 3, y: 0 }).start).toEqual({ x: 1, y: 0 });
    });

    it("copies Cyrillic as is", async () => {
        const buffer = await bufferWith("привет мир");

        expect(text(buffer, [0, 0], [9, 0])).toBe("привет мир");
    });

    it("non-breaking spaces copy as plain spaces", async () => {
        const buffer = await bufferWith("a b  ");

        expect(text(buffer, [0, 0], [9, 0])).toBe("a b");
    });

    it("rows past the buffer's end add nothing", async () => {
        const buffer = await bufferWith("one");

        expect(selectionText(buffer, { start: { x: 0, y: 0 }, end: { x: 3, y: 40 } })).toBe("one\n\n\n\n");
    });
});
