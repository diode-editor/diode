import type { ITerminalBuffer } from "../../../terminal/common/terminalBuffer.ts";
import type { ITerminalCellPosition, ITerminalCellRange } from "../../links/common/terminalLinkProvider.ts";

/** Inclusive cells in reading order: `start` is never after `end`. */
export type ITerminalSelectionRange = ITerminalCellRange;

export function isBefore(a: ITerminalCellPosition, b: ITerminalCellPosition): boolean {
    // Stryker disable next-line EqualityOperator: equivalent — of two equal points either order is the same range
    return a.y < b.y || (a.y === b.y && a.x < b.x);
}

/**
 * The cells from the press to the pointer, either way, the way a terminal selects: the first row from the press to
 * the edge, the rows between whole, the last one up to the pointer. A start on the right half of a wide character
 * takes the whole character. The anchor of a word or line selection is the whole word or line, `anchorEnd` its last
 * cell: the selection keeps all of it whichever way the head goes.
 */
export function selectionRange(
    buffer: ITerminalBuffer,
    anchor: ITerminalCellPosition,
    head: ITerminalCellPosition,
    anchorEnd: ITerminalCellPosition = anchor,
): ITerminalSelectionRange {
    const [start, end] = isBefore(head, anchor) ? [head, anchorEnd] : [anchor, head];
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

/**
 * Upstream `SelectionService._getWordAt` for a double click: the cell's word, up to the nearest separator or the edge
 * of the line, across soft wraps; a wide character is one character of a word. A separator is a word of its own. A
 * cell nothing was written to (the blank right of the text, the gap a tab leaves) has no word.
 */
export function wordRangeAt(
    buffer: ITerminalBuffer,
    position: ITerminalCellPosition,
    separators: string,
): ITerminalSelectionRange | undefined {
    const at = widthAt(buffer, position) === 0 ? { x: position.x - 1, y: position.y } : position;
    const chars = charsAt(buffer, at);
    if (chars === "") return undefined;
    if (separators.includes(chars)) return { start: at, end: endOfCell(buffer, at) };
    // The right half of a wide character belongs to it. An empty cell ends the word too: every string includes "".
    const isWordCell = (cell: ITerminalCellPosition): boolean =>
        widthAt(buffer, cell) === 0 || !separators.includes(charsAt(buffer, cell));
    let start = at;
    for (
        let cell = previousCell(buffer, start);
        cell !== undefined && isWordCell(cell);
        cell = previousCell(buffer, cell)
    ) {
        start = cell;
    }
    let end = at;
    for (let cell = nextCell(buffer, end); cell !== undefined && isWordCell(cell); cell = nextCell(buffer, cell)) {
        end = cell;
    }
    return { start, end };
}

/** Upstream `_selectLineAt`: the logical line, all the rows a soft wrap split it into. */
export function lineRangeAt(buffer: ITerminalBuffer, y: number): ITerminalSelectionRange {
    // The first row of the buffer never continues another.
    let first = y;
    while (isWrapped(buffer, first)) first--;
    let last = y;
    while (isWrapped(buffer, last + 1)) last++;
    return { start: { x: 0, y: first }, end: { x: buffer.cols - 1, y: last } };
}

/** `""` — nothing was written to the cell, or there is no such cell. */
function charsAt(buffer: ITerminalBuffer, cell: ITerminalCellPosition): string {
    return buffer.getLine(cell.y)?.getCell(cell.x)?.getChars() ?? "";
}

function widthAt(buffer: ITerminalBuffer, cell: ITerminalCellPosition): number | undefined {
    return buffer.getLine(cell.y)?.getCell(cell.x)?.getWidth();
}

/** A wide character ends on its right half. */
function endOfCell(buffer: ITerminalBuffer, cell: ITerminalCellPosition): ITerminalCellPosition {
    return widthAt(buffer, cell) === 2 ? { x: cell.x + 1, y: cell.y } : cell;
}

/** The cell before, through a soft wrap; the gap a wide character left at the edge is skipped. */
function previousCell(buffer: ITerminalBuffer, cell: ITerminalCellPosition): ITerminalCellPosition | undefined {
    if (cell.x > 0) return { x: cell.x - 1, y: cell.y };
    if (!isWrapped(buffer, cell.y)) return undefined;
    const last = { x: buffer.cols - 1, y: cell.y - 1 };
    return isWrapGap(buffer, last) ? { x: last.x - 1, y: last.y } : last;
}

/** The cell after, through a soft wrap; the gap a wide character left at the edge is skipped. */
function nextCell(buffer: ITerminalBuffer, cell: ITerminalCellPosition): ITerminalCellPosition | undefined {
    const next = { x: cell.x + 1, y: cell.y };
    if (next.x < buffer.cols && !isWrapGap(buffer, next)) return next;
    return isWrapped(buffer, cell.y + 1) ? { x: 0, y: cell.y + 1 } : undefined;
}

/** The row continues the previous one (soft wrap); a row past the buffer does not. */
function isWrapped(buffer: ITerminalBuffer, y: number): boolean {
    return buffer.getLine(y)?.isWrapped === true;
}

/**
 * The empty last cell of a row: past it a word goes on only on a row the soft wrap continues, where it is the gap a
 * wide character that did not fit left behind.
 */
function isWrapGap(buffer: ITerminalBuffer, cell: ITerminalCellPosition): boolean {
    return cell.x === buffer.cols - 1 && charsAt(buffer, cell) === "";
}
