import type { ITerminalBuffer } from "../../../terminal/common/terminalBuffer.ts";
import type { ITerminalCellPosition } from "../../links/common/terminalLinkProvider.ts";

/** Inclusive cells in reading order: `start` is never after `end`. */
export interface ITerminalSelectionRange {
    readonly start: ITerminalCellPosition;
    readonly end: ITerminalCellPosition;
}

function isBefore(a: ITerminalCellPosition, b: ITerminalCellPosition): boolean {
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
    const isContinuation = start.x > 0 && buffer.getLine(start.y)?.getCell(start.x)?.getWidth() === 0;
    return { start: isContinuation ? { x: start.x - 1, y: start.y } : start, end };
}

export function isInSelection(range: ITerminalSelectionRange, x: number, y: number): boolean {
    return !isBefore({ x, y }, range.start) && !isBefore(range.end, { x, y });
}

/** The whole buffer, scrollback included (upstream `selectAll`). */
export function selectAllRange(buffer: ITerminalBuffer): ITerminalSelectionRange {
    return { start: { x: 0, y: 0 }, end: { x: buffer.cols - 1, y: buffer.length - 1 } };
}

/**
 * Upstream `SelectionService.selectionText`: rows a soft wrap split are joined without a line break; each line
 * loses its trailing blanks; a wide character is its text once.
 */
export function selectionText(buffer: ITerminalBuffer, range: ITerminalSelectionRange): string {
    const lines: string[] = [];
    let current = "";
    for (let y = range.start.y; y <= range.end.y; y++) {
        const line = buffer.getLine(y);
        if (line === undefined) break;
        const from = y === range.start.y ? range.start.x : 0;
        const to = y === range.end.y ? range.end.x + 1 : buffer.cols;
        const text = line.translateToString(false, from, to);
        if (y > range.start.y && line.isWrapped) {
            current += text;
        } else {
            if (y > range.start.y) lines.push(current);
            current = text;
        }
    }
    lines.push(current);
    return lines.map((line) => line.replace(/[ \u00a0]+$/u, "").replace(/\u00a0/gu, " ")).join("\n");
}
