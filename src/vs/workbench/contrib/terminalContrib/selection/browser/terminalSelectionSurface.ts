import { compositeOver, DEFAULT_COLOR } from "@tuidom/core/common/colorUtils";
import type { TerminalCell, TerminalMouseEventData } from "@tuidom/core/common/iTerminalSurface";

import { Emitter } from "../../../../../base/common/event.ts";
import { combinedDisposable, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ITerminalDecoratedSurface } from "../../../terminal/browser/terminalWidgetFactory.ts";
import type { ITerminalBuffer, ITerminalMarker } from "../../../terminal/common/terminalBuffer.ts";
import { isInCellRange, type ITerminalCellPosition } from "../../links/common/terminalLinkProvider.ts";
import { type ITerminalSelectionRange, selectionRange, selectionText } from "../common/terminalSelection.ts";

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
    readonly anchor: ITerminalCellPosition;
    readonly head: ITerminalCellPosition;
    /** Follows the rows as the scrollback trims lines off the top; none on the alternate buffer. */
    readonly marker: ITerminalMarker | undefined;
    /** `marker.line` when the rows were stored. */
    readonly markerLine: number;
    readonly bufferType: ITerminalBuffer["type"];
}

interface IDrag {
    /** The buffer view the drag began over; it follows the emulator. */
    readonly buffer: ITerminalBuffer;
    readonly anchor: ITerminalCellPosition;
    /** Shift+drag over a program that tracks the mouse: none of the drag's events reach the program. */
    readonly ownsEvents: boolean;
    pointer: { readonly col: number; readonly row: number };
}

/**
 * The session as the terminal widget sees it, plus the text selection of xterm.js's `SelectionService`: a left drag
 * selects, the selected cells are painted with the selection colors, a plain click clears. A program that turned
 * mouse tracking on owns the mouse, Shift+drag still selects. Rows are buffer rows, so scrolling and new output
 * keep the selection on its text; typing into the shell, switching to the alternate buffer and a resize clear it.
 */
export class TerminalSelectionSurface implements ITerminalDecoratedSurface {
    private selection: IStoredSelection | undefined;
    private drag: IDrag | undefined;
    private dragScroll: ReturnType<typeof setInterval> | undefined;
    /** `null` — to compute on the next read. */
    private cachedRange: ITerminalSelectionRange | undefined | null = null;
    private host: ITerminalSelectionHost | undefined;
    /** The widget has the focus: the selection is painted with the active color. */
    private focused = false;
    private readonly onDidChangeEmitter = new Emitter<void>();
    /** The selection appeared, changed or was cleared. */
    public readonly onDidChangeSelection = this.onDidChangeEmitter.event;

    public constructor(private readonly session: ITerminalDecoratedSurface) {}

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
        return this.range() !== undefined;
    }

    /** `undefined` without a selection. */
    public get selectionText(): string | undefined {
        const range = this.range();
        const buffer = this.session.buffer;
        if (range === undefined || buffer === undefined) return undefined;
        return selectionText(buffer, range);
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
        const range = this.range();
        const host = this.host;
        if (range === undefined || host === undefined) return true;
        const buffer = this.session.buffer;
        // Stryker disable next-line ConditionalExpression: equivalent — a range exists only over a buffer; the check narrows the type
        if (buffer === undefined || !isInCellRange(range, x, buffer.viewportY + y)) return true;
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
        this.clearSelection();
        this.drag = {
            buffer,
            anchor: { x: clamp(event.col, buffer.cols), y: buffer.viewportY + event.row },
            ownsEvents,
            pointer: { col: event.col, row: event.row },
        };
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
        this.selection?.marker?.dispose();
        this.store(buffer, { x: buffer.cols - 1, y: buffer.length - 1 }, { x: 0, y: 0 });
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
    }

    /** Past the top edge the selection runs to the start of the top row, past the bottom to the end of the bottom one. */
    private extendTo(drag: IDrag): void {
        const { buffer, pointer } = drag;
        const { col, row } = pointer;
        let head: ITerminalCellPosition;
        if (row < 0) head = { x: 0, y: buffer.viewportY };
        else if (row >= buffer.rows) head = { x: buffer.cols - 1, y: buffer.viewportY + buffer.rows - 1 };
        else head = { x: clamp(col, buffer.cols), y: buffer.viewportY + row };
        const current = this.selection;
        if (current === undefined) {
            // A press and a release in the same cell is a click, not a selection.
            if (head.x !== drag.anchor.x || head.y !== drag.anchor.y) this.store(buffer, drag.anchor, head);
            return;
        }
        const stored = { x: head.x, y: head.y - shiftOf(current) };
        if (current.head.x === stored.x && current.head.y === stored.y) return;
        this.selection = { ...current, head: stored };
        this.changed();
    }

    private store(buffer: ITerminalBuffer, anchor: ITerminalCellPosition, head: ITerminalCellPosition): void {
        const marker = buffer.registerMarker();
        this.selection = { anchor, head, marker, markerLine: marker?.line ?? 0, bufferType: buffer.type };
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
            this.scrollLines(row < 0 ? row : row - drag.buffer.rows + 1);
        }, DRAG_SCROLL_INTERVAL_MS);
    }

    private stopDragScroll(): void {
        clearInterval(this.dragScroll);
        this.dragScroll = undefined;
    }

    private onSessionUpdate(): void {
        this.cachedRange = null;
        const selection = this.selection;
        if (selection === undefined) return;
        // The scrollback trimmed all of the selection's text (or the cursor row its marker is on).
        if (
            this.session.buffer?.type !== selection.bufferType ||
            selection.marker?.line === -1 ||
            this.range() === undefined
        ) {
            this.clearSelection();
        }
    }

    private changed(): void {
        this.cachedRange = null;
        this.onDidChangeEmitter.fire();
    }

    private range(): ITerminalSelectionRange | undefined {
        if (this.cachedRange !== null) return this.cachedRange;
        const selection = this.selection;
        const buffer = this.session.buffer;
        let range: ITerminalSelectionRange | undefined;
        if (selection !== undefined && buffer !== undefined) {
            const shift = shiftOf(selection);
            range = selectionRange(
                buffer,
                { x: selection.anchor.x, y: selection.anchor.y + shift },
                { x: selection.head.x, y: selection.head.y + shift },
            );
            // The scrollback trimmed the selection's top rows: what is left of it starts at the buffer's top; trimmed
            // whole, nothing is left.
            if (range.end.y < 0) range = undefined;
            else if (range.start.y < 0) range = { start: { x: 0, y: 0 }, end: range.end };
        }
        this.cachedRange = range;
        return range;
    }
}

/** How many rows the scrollback trimmed off the top since the selection was stored. */
function shiftOf(selection: IStoredSelection): number {
    return selection.marker === undefined ? 0 : selection.marker.line - selection.markerLine;
}

function clamp(col: number, cols: number): number {
    return Math.max(0, Math.min(col, cols - 1));
}
