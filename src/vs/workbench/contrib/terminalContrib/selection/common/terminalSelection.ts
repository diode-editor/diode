import type { ITerminalBuffer } from "../../../terminal/common/terminalBuffer.ts";
import type { ITerminalCellPosition, ITerminalCellRange } from "../../links/common/terminalLinkProvider.ts";

/** Inclusive cells in reading order: `start` is never after `end`. */
export type ITerminalSelectionRange = ITerminalCellRange;

function isBefore(a: ITerminalCellPosition, b: ITerminalCellPosition): boolean {
    // Stryker disable next-line EqualityOperator: equivalent — of two equal points either order is the same range
    return a.y < b.y || (a.y === b.y && a.x < b.x);
}

/**
 * The cells from the press to the pointer, either way, the way a terminal selects: the first row from the press to
 * the edge, the rows between whole, the last one up to the pointer. A start on the right half of a wide character
 * takes the whole character.
 */
export function selectionRange(
    buffer: ITerminalBuffer,
    anchor: ITerminalCellPosition,
    head: ITerminalCellPosition,
): ITerminalSelectionRange {
    const [start, end] = isBefore(head, anchor) ? [head, anchor] : [anchor, head];
    const isContinuation = buffer.getLine(start.y)?.getCell(start.x)?.getWidth() === 0;
    return { start: isContinuation ? { x: start.x - 1, y: start.y } : start, end };
}

/**
 * Upstream `SelectionService.selectionText`: rows a soft wrap split are joined without a line break; each line
 * loses its trailing blanks; a wide character is its text once.
 */
export function selectionText(buffer: ITerminalBuffer, range: ITerminalSelectionRange): string {
    const lines: string[] = [];
    for (let y = range.start.y; y <= range.end.y; y++) {
        const line = buffer.getLine(y);
        if (line === undefined) break;
        const from = y === range.start.y ? range.start.x : 0;
        const to = y === range.end.y ? range.end.x + 1 : buffer.cols;
        // Trims the cells nothing was written to: the gap a wide character left at the edge when it wrapped.
        const text = line.translateToString(true, from, to);
        if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
        else lines.push(text);
    }
    return lines.map((line) => line.replace(/[ \u00a0]+$/u, "").replace(/\u00a0/gu, " ")).join("\n");
}
