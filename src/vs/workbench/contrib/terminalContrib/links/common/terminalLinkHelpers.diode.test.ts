import { describe, expect, it } from "vitest";

import type { ITerminalBuffer, ITerminalBufferLine } from "../../../terminal/common/terminalBuffer.ts";

import { convertLinkRangeToBuffer, getXtermLineContent } from "./terminalLinkHelpers.ts";

// Cases the upstream suite (terminalLinkHelpers.test.ts) leaves out: rows and cells that run out.

/** A row of `cells` (chars and width); cells past them don't exist. */
function rowOf(cells: readonly [chars: string, width: number][], isWrapped = false): ITerminalBufferLine {
    return {
        isWrapped,
        getCell: (x) => {
            const cell = cells.at(x);
            return cell === undefined ? undefined : { getChars: () => cell[0], getWidth: () => cell[1] };
        },
        translateToString: () => cells.map(([chars]) => chars).join(""),
    };
}

function asciiRow(text: string, isWrapped = false): ITerminalBufferLine {
    return rowOf(
        Array.from(text, (char): [string, number] => [char, 1]),
        isWrapped,
    );
}

describe("convertLinkRangeToBuffer — beyond the upstream suite", () => {
    it("the start offset scan stops at the rows provided", () => {
        const lines = [asciiRow("abcdefghij", true)];
        // The link starts on the second wrapped row, which was not passed.
        const range = convertLinkRangeToBuffer(
            lines,
            10,
            { startColumn: 12, startLineNumber: 1, endColumn: 15, endLineNumber: 1 },
            0,
        );
        expect(range).toStrictEqual({ start: { x: 2, y: 2 }, end: { x: 4, y: 2 } });
    });

    it("cells missing past a row's content end its scan; the offset gathered before stays", () => {
        // A wide character, its null cell, "a"; nothing past them.
        const lines = [
            rowOf([
                ["文", 2],
                ["", 0],
                ["a", 1],
            ]),
        ];
        const range = convertLinkRangeToBuffer(
            lines,
            10,
            { startColumn: 8, startLineNumber: 1, endColumn: 9, endLineNumber: 1 },
            0,
        );
        expect(range).toStrictEqual({ start: { x: 9, y: 1 }, end: { x: 9, y: 1 } });
    });
});

describe("getXtermLineContent — beyond the upstream suite", () => {
    it("rows past the buffer end add nothing", () => {
        const rows = [asciiRow("ab"), asciiRow("cd", true)];
        const buffer: ITerminalBuffer = {
            cols: 10,
            rows: 2,
            viewportY: 0,
            length: rows.length,
            getLine: (y) => rows.at(y),
        };
        expect(getXtermLineContent(buffer, 0, 5, 10)).toBe("abcd");
    });
});
