import { compositeOver, DEFAULT_COLOR } from "@tuidom/core/common/colorUtils";
import type { TerminalCell, TerminalMouseEventData } from "@tuidom/core/common/iTerminalSurface";

import { Emitter } from "../../../../../base/common/event.ts";
import { combinedDisposable, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ITerminalDecoratedSurface } from "../../../terminal/browser/terminalWidgetFactory.ts";
import type { ITerminalBuffer, ITerminalMarker } from "../../../terminal/common/terminalBuffer.ts";
import { isInCellRange, type ITerminalCellPosition } from "../../links/common/terminalLinkProvider.ts";
import {
    isBefore,
    type ITerminalSelectionRange,
    lineRangeAt,
    selectionRange,
    selectionText,
    wordRangeAt,
} from "../common/terminalSelection.ts";

export type TerminalSelectionColor =
    | "terminal.background"
    | "terminal.selectionBackground"
    | "terminal.inactiveSelectionBackground"
    | "terminal.selectionForeground";

/** The widget the selection is drawn in: its var scope holds the theme's colors. */
export interface ITerminalSelectionHost {
    styleVar(name: TerminalSelectionColor, fallback?: number): number;
}

/** Upstream `DRAG_SCROLL_INTERVAL`: while the pointer is past an edge, the drag scrolls at this pace. */
const DRAG_SCROLL_INTERVAL_MS = 50;

interface IStoredSelection {
    /** The buffer view the selection was made over; it follows the emulator. */
    readonly buffer: ITerminalBuffer;
    readonly anchor: ITerminalCellPosition;
    /** The last cell of the word or line a double or triple click anchored the selection on; else `anchor`. */
    readonly anchorEnd: ITerminalCellPosition;
    readonly head: ITerminalCellPosition;
    /** Follows the rows as the scrollback trims lines off the top; none on the alternate buffer. */
    readonly marker: ITerminalMarker | undefined;
    /** `marker.line` when the rows were stored. */
    readonly markerLine: number;
    readonly bufferType: ITerminalBuffer["type"];
}

/** The selection as it is now: its buffer and the cells, the scrollback trim applied. */
interface ISelectedCells {
    readonly buffer: ITerminalBuffer;
    readonly range: ITerminalSelectionRange;
}

/** What a drag grows by: upstream `SelectionMode` NORMAL, WORD (a double click), LINE (a triple click). */
type DragUnit = "cell" | "word" | "line";

interface IDrag {
    /** The buffer view the drag began over; it follows the emulator. */
    readonly buffer: ITerminalBuffer;
    readonly unit: DragUnit;
    /** Where a cell drag selects from, once the pointer leaves the pressed cell. */
    readonly anchor: ITerminalCellPosition;
    /** Shift+drag over a program that tracks the mouse: none of the drag's events reach the program. */
    readonly ownsEvents: boolean;
    pointer: { readonly col: number; readonly row: number };
}

/**
 * The session as the terminal widget sees it, plus the text selection of xterm.js's `SelectionService`: a left drag
 * selects, a double click selects a word and a triple click a line (dragging on grows the selection by words or
 * lines), Shift+click moves the selection's end, the selected cells are painted with the selection colors, a plain
 * click clears. A program that turned mouse tracking on owns the mouse, with Shift the clicks and drags still select.
 * Rows are buffer rows, so scrolling and new output
 * keep the selection on its text; typing into the shell, switching to the alternate buffer and a resize clear it.
 */
export class TerminalSelectionSurface implements ITerminalDecoratedSurface {
    private selection: IStoredSelection | undefined;
    private drag: IDrag | undefined;
    private dragScroll: ReturnType<typeof setInterval> | undefined;
    /** `null` — to compute on the next read. */
    private cachedCells: ISelectedCells | undefined | null = null;
    private host: ITerminalSelectionHost | undefined;
    /** The widget has the focus: the selection is painted with the active color. */
    private focused = false;
    private readonly onDidChangeEmitter = new Emitter<void>();
    /** The selection appeared, changed or was cleared. */
    public readonly onDidChangeSelection = this.onDidChangeEmitter.event;
    private readonly onDidFinishEmitter = new Emitter<void>();
    /**
     * A mouse gesture (a drag, a double or triple click, Shift+click) or Select All left a selection: upstream copies
     * on selection here (xterm fires `onSelectionChange` on the release, not on every step of a drag).
     */
    public readonly onDidFinishSelection = this.onDidFinishEmitter.event;

    /** `wordSeparators` is read on every double click: a change of the setting applies at once. */
    public constructor(
        private readonly session: ITerminalDecoratedSurface,
        private readonly wordSeparators: () => string,
    ) {}

    public attach(host: ITerminalSelectionHost): void {
        this.host = host;
    }

    public setFocused(focused: boolean): void {
        this.focused = focused;
    }

    public get buffer(): ITerminalBuffer | undefined {
        return this.session.buffer;
    }

    public get hasSelection(): boolean {
        return this.cells() !== undefined;
    }

    /** `undefined` without a selection. */
    public get selectionText(): string | undefined {
        const cells = this.cells();
        return cells === undefined ? undefined : selectionText(cells.buffer, cells.range);
    }

    public get isExited(): boolean {
        return this.session.isExited;
    }

    public get mouseEventsActive(): boolean {
        return this.session.mouseEventsActive;
    }

    public get applicationCursorKeys(): boolean {
        return this.session.applicationCursorKeys;
    }

    public get kittyKeyboardFlags(): number {
        return this.session.kittyKeyboardFlags;
    }

    public get scrollOffset(): number {
        return this.session.scrollOffset;
    }

    public readCell(x: number, y: number, out: TerminalCell): boolean {
        if (!this.session.readCell(x, y, out)) return false;
        const cells = this.cells();
        const host = this.host;
        if (cells === undefined || host === undefined) return true;
        if (!isInCellRange(cells.range, x, cells.buffer.viewportY + y)) return true;
        const background = host.styleVar(
            this.focused ? "terminal.selectionBackground" : "terminal.inactiveSelectionBackground",
        );
        out.bg = compositeOver(background, out.bg === DEFAULT_COLOR ? host.styleVar("terminal.background") : out.bg);
        const foreground = host.styleVar("terminal.selectionForeground", DEFAULT_COLOR);
        if (foreground !== DEFAULT_COLOR) out.fg = foreground;
        return true;
    }

    public getCursor(): { x: number; y: number } | null {
        return this.session.getCursor();
    }

    /** Input into the shell clears the selection (xterm's `onUserInput`). */
    public write(data: string): void {
        this.clearSelection();
        this.session.write(data);
    }

    public sendMouse(event: TerminalMouseEventData): void {
        const drag = this.drag;
        if (drag !== undefined) {
            this.continueDrag(drag, event);
            return;
        }
        const buffer = this.session.buffer;
        const ownsEvents = this.session.mouseEventsActive;
        if (
            event.button !== "left" ||
            event.action !== "down" ||
            buffer === undefined ||
            (ownsEvents && !event.shift)
        ) {
            this.session.sendMouse(event);
            return;
        }
        this.press(buffer, event, ownsEvents);
        if (!ownsEvents) this.session.sendMouse(event);
    }

    /** The wheel during a drag moves the selection's end with the text under the pointer. */
    public scrollLines(delta: number): void {
        this.session.scrollLines(delta);
        if (this.drag !== undefined) this.extendTo(this.drag);
    }

    public resize(cols: number, rows: number): void {
        const buffer = this.session.buffer;
        if (buffer !== undefined && (buffer.cols !== cols || buffer.rows !== rows)) this.clearSelection();
        this.session.resize(cols, rows);
    }

    public onUpdate(cb: () => void): IDisposable {
        return combinedDisposable(
            this.session.onUpdate(() => {
                this.onSessionUpdate();
                cb();
            }),
            this.onDidChangeEmitter.event(cb),
        );
    }

    public onExit(cb: (exitCode: number) => void): IDisposable {
        return this.session.onExit(cb);
    }

    public clearSelection(): void {
        const selection = this.selection;
        if (selection === undefined) return;
        selection.marker?.dispose();
        this.selection = undefined;
        this.changed();
    }

    /** The whole buffer, scrollback included; the anchor is at the end, the scrollback trims the start first. */
    public selectAll(): void {
        const buffer = this.session.buffer;
        if (buffer === undefined) return;
        // Stryker disable next-line ArithmeticOperator: equivalent — cells past the last column and rows past the end add nothing to the text or the paint
        this.store(buffer, { x: buffer.cols - 1, y: buffer.length - 1 }, { x: 0, y: 0 });
        this.onDidFinishEmitter.fire();
    }

    /**
     * Upstream `handleMouseDown`: Shift+click over the shell moves the end of the selection there and drags on from
     * its anchor (`_handleIncrementalClick`); a click starts a drag from a cell, a double click selects the word, a
     * triple click the line. Ctrl+click is a link's: it never selects a word.
     */
    private press(buffer: ITerminalBuffer, event: TerminalMouseEventData, ownsEvents: boolean): void {
        const point = { x: clamp(event.col, buffer.cols), y: buffer.viewportY + event.row };
        const pointer = { col: event.col, row: event.row };
        if (event.shift && !ownsEvents && this.selection !== undefined) {
            this.drag = { buffer, unit: "cell", anchor: point, ownsEvents, pointer };
            this.extendTo(this.drag);
            return;
        }
        this.clearSelection();
        const clicks = event.ctrl ? 1 : (event.detail ?? 1);
        // A double click where no word is starts a plain drag.
        const range = clicks === 1 ? undefined : this.rangeAt(buffer, clicks === 2 ? "word" : "line", point);
        const unit: DragUnit = range === undefined ? "cell" : clicks === 2 ? "word" : "line";
        this.drag = { buffer, unit, anchor: point, ownsEvents, pointer };
        if (range !== undefined) this.store(buffer, range.start, range.end, range.end);
    }

    /** The word (none where nothing is written) or the logical line at the point. */
    private rangeAt(
        buffer: ITerminalBuffer,
        unit: "word" | "line",
        point: ITerminalCellPosition,
    ): ITerminalSelectionRange | undefined {
        return unit === "word" ? wordRangeAt(buffer, point, this.wordSeparators()) : lineRangeAt(buffer, point.y);
    }

    private continueDrag(drag: IDrag, event: TerminalMouseEventData): void {
        if (!drag.ownsEvents) this.session.sendMouse(event);
        const release = event.button === "left" && event.action === "up";
        if (event.action !== "move" && !release) return;
        drag.pointer = { col: event.col, row: event.row };
        this.extendTo(drag);
        if (!release) {
            this.updateDragScroll(drag);
            return;
        }
        this.drag = undefined;
        this.stopDragScroll();
        if (this.selection !== undefined) this.onDidFinishEmitter.fire();
    }

    /** Past the top edge the selection runs to the start of the top row, past the bottom to the end of the bottom one. */
    private extendTo(drag: IDrag): void {
        const { buffer, pointer } = drag;
        const { col, row } = pointer;
        let head: ITerminalCellPosition;
        if (row < 0) {
            head = { x: 0, y: buffer.viewportY };
        } else if (row >= buffer.rows) {
            // Stryker disable next-line ArithmeticOperator: equivalent — past the bottom the head is the selection's end, and cells past the last column add nothing
            head = { x: buffer.cols - 1, y: buffer.viewportY + buffer.rows - 1 };
        } else {
            head = { x: clamp(col, buffer.cols), y: buffer.viewportY + row };
        }
        const current = this.selection;
        if (current === undefined) {
            // A press and a release in the same cell is a click, not a selection.
            if (head.x !== drag.anchor.x || head.y !== drag.anchor.y) this.store(buffer, drag.anchor, head);
            return;
        }
        // Upstream `_selectToWordAt` and the LINE mode of `_handleMouseMove`: the head takes the whole word or line,
        // its start before the anchor, its end after it.
        const shift = shiftOf(current);
        if (drag.unit !== "cell") {
            const range = this.rangeAt(buffer, drag.unit, head);
            const before = isBefore(head, { x: current.anchor.x, y: current.anchor.y + shift });
            if (range !== undefined) head = before ? range.start : range.end;
        }
        const stored = { x: head.x, y: head.y - shift };
        if (current.head.x === stored.x && current.head.y === stored.y) return;
        this.selection = { ...current, head: stored };
        this.changed();
    }

    private store(
        buffer: ITerminalBuffer,
        anchor: ITerminalCellPosition,
        head: ITerminalCellPosition,
        anchorEnd = anchor,
    ): void {
        this.selection?.marker?.dispose();
        const marker = buffer.registerMarker();
        this.selection = {
            buffer,
            anchor,
            anchorEnd,
            head,
            marker,
            markerLine: marker?.line ?? 0,
            bufferType: buffer.type,
        };
        this.changed();
    }

    private updateDragScroll(drag: IDrag): void {
        const outside = drag.pointer.row < 0 || drag.pointer.row >= drag.buffer.rows;
        if (!outside) {
            this.stopDragScroll();
            return;
        }
        this.dragScroll ??= setInterval(() => {
            const row = drag.pointer.row;
            // Stryker disable next-line EqualityOperator: equivalent — the timer runs only while the pointer is past an edge, never on row 0
            this.scrollLines(row < 0 ? row : row - drag.buffer.rows + 1);
        }, DRAG_SCROLL_INTERVAL_MS);
    }

    private stopDragScroll(): void {
        clearInterval(this.dragScroll);
        this.dragScroll = undefined;
    }

    private onSessionUpdate(): void {
        this.cachedCells = null;
        const selection = this.selection;
        if (selection === undefined) return;
        // The scrollback trimmed all of the selection's text (or the cursor row its marker is on).
        if (
            selection.buffer.type !== selection.bufferType ||
            selection.marker?.line === -1 ||
            this.cells() === undefined
        ) {
            this.clearSelection();
        }
    }

    private changed(): void {
        this.cachedCells = null;
        this.onDidChangeEmitter.fire();
    }

    private cells(): ISelectedCells | undefined {
        // Stryker disable next-line ConditionalExpression: equivalent — the cache only spares computing the same cells again
        if (this.cachedCells !== null) return this.cachedCells;
        const selection = this.selection;
        let cells: ISelectedCells | undefined;
        if (selection !== undefined) {
            const { buffer } = selection;
            const shift = shiftOf(selection);
            const range = selectionRange(
                buffer,
                { x: selection.anchor.x, y: selection.anchor.y + shift },
                { x: selection.head.x, y: selection.head.y + shift },
                { x: selection.anchorEnd.x, y: selection.anchorEnd.y + shift },
            );
            // The scrollback trimmed the selection's top rows: what is left of it starts at the buffer's top; trimmed
            // whole, nothing is left.
            if (range.end.y >= 0) {
                cells = { buffer, range: range.start.y < 0 ? { start: { x: 0, y: 0 }, end: range.end } : range };
            }
        }
        this.cachedCells = cells;
        return cells;
    }
}

/** How many rows the scrollback trimmed off the top since the selection was stored. */
function shiftOf(selection: IStoredSelection): number {
    return selection.marker === undefined ? 0 : selection.marker.line - selection.markerLine;
}

function clamp(col: number, cols: number): number {
    return Math.max(0, Math.min(col, cols - 1));
}
