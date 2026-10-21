// VT emulator over @xterm/headless — the shared half of `EmbeddedTerminalSession` and
// `ExtensionPtySession`; the subclass decides where output comes from and input goes. @xterm/headless is a
// lazy chunk (like upstream `_xtermReadyPromise`): until it loads, output is queued,
// input and resize go to the process immediately, and the grid reads as empty.

import { DEFAULT_COLOR } from "@tuidom/core/common/colorUtils";
import type {
    ITerminalSurface,
    TerminalCell,
    TerminalMouseAction,
    TerminalMouseButton,
    TerminalMouseEventData,
} from "@tuidom/core/common/iTerminalSurface";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type * as XtermModule from "@xterm/headless";
import type { IBufferCell, Terminal } from "@xterm/headless";

import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { importLazyModule } from "../../../../base/common/lazyModule.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { ITerminalRelaunchOptions } from "../common/terminalSessionFactory.ts";
import {
    buildXtermPalette,
    DEFAULT_XTERM_PALETTE,
    type XtermPalette,
    xtermPaletteToRgb,
} from "../common/xtermPalette.ts";

export interface CoreMouseEvent {
    col: number; // 0-based
    row: number; // 0-based
    button: number; // LEFT=0 MIDDLE=1 RIGHT=2 NONE=3 WHEEL=4
    action: number; // UP=0 DOWN=1 LEFT=2 RIGHT=3 MOVE=32
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
}

interface ICoreMouseService {
    triggerMouseEvent(event: CoreMouseEvent): boolean;
    readonly areMouseEventsActive: boolean;
}

// Values of the xterm CoreMouseButton/CoreMouseAction enums: the widget doesn't know about xterm.
const CORE_BUTTON: Record<Exclude<TerminalMouseButton, "wheel">, number> = { left: 0, middle: 1, right: 2, none: 3 };
const WHEEL_BUTTON = 4;
const ACTION_UP = 0;
const ACTION_DOWN = 1;
// MOVE is 32, not 4: in xterm it's the "motion" bit OR-ed into the button; with 4 the emulator
// dropped moves and encoded drag as a repeated left press.
const ACTION_MOVE = 32;
const WHEEL_ACTION: Record<"up" | "down" | "left" | "right", number> = { up: 0, down: 1, left: 2, right: 3 };

/** A new process in a reused terminal starts on a new line (upstream `'\n\x1b[G'`). */
const NEW_LINE_AT_START = "\n\x1b[G";
/** Erase screen and scrollback, cursor to home (task `presentation.clear`). */
const CLEAR_ALL = "\x1b[2J\x1b[3J\x1b[H";

/**
 * The CJS build (lazy chunk) puts the values in `default`; ESM (the tsx loader from
 * sources) has only named exports.
 */
export type XtermNamespace = { readonly default: typeof XtermModule } | typeof XtermModule;

export function xtermModuleOf(namespace: XtermNamespace): typeof XtermModule {
    return "default" in namespace ? namespace.default : namespace;
}

/** @xterm/headless is a lazy chunk: loaded on the first terminal session, not at startup. */
export function loadXterm(): Promise<XtermNamespace> {
    return importLazyModule("@xterm/headless", () => import("@xterm/headless") as Promise<XtermNamespace>);
}

export interface XtermSurfaceOptions {
    cols: number;
    rows: number;
    scrollback?: number;
}

export abstract class XtermSurface implements ITerminalSurface, IDisposable {
    // `undefined` until the chunk loads and after a load failure.
    private term: Terminal | undefined;
    private readonly pendingOutput: string[] = [];
    private disposed = false;
    /** Never rejects: resolves on load failure too (upstream `xtermReadyPromise`). */
    public readonly xtermReady: Promise<void>;
    private readonly onUpdateEmitter = new Emitter<void>();
    private readonly onExitEmitter = new Emitter<number>();
    private readonly onDidInputAfterExitEmitter = new Emitter<void>();
    // Reused cell — getCell(x, cell) doesn't allocate a new object per cell.
    private cellBuffer: IBufferCell | undefined;
    protected cols: number;
    protected rows: number;
    private exited = false;
    // Viewport offset into scrollback, in lines up from the bottom (0 = live output).
    private viewportScrollOffset = 0;
    private palette: XtermPalette = DEFAULT_XTERM_PALETTE;

    protected constructor(options: XtermSurfaceOptions) {
        this.cols = options.cols;
        this.rows = options.rows;
        const scrollback = options.scrollback ?? 1000;
        this.xtermReady = loadXterm()
            .then((xterm) => {
                this.attachTerminal(xtermModuleOf(xterm), scrollback);
            })
            .catch((error: unknown) => {
                this.failToLoad(error);
            });
    }

    /** A resize before load has already reached the process and landed in `cols`/`rows`. */
    private attachTerminal(xterm: typeof XtermModule, scrollback: number): void {
        if (this.disposed) return;
        const term = new xterm.Terminal({ cols: this.cols, rows: this.rows, allowProposedApi: true, scrollback });
        // Emulator replies (DSR/DA, mouse reports) take the input path, guarded against a dead process.
        term.onData((data) => {
            this.write(data);
        });
        this.term = term;
        for (const data of this.pendingOutput.splice(0)) this.writeToTerm(term, data);
    }

    /** Broken chunk: stop the process and exit the session with code 1 so the terminal isn't silently blank. */
    private failToLoad(error: unknown): void {
        onUnexpectedError(error);
        this.pendingOutput.length = 0;
        if (this.disposed) return;
        this.disposeProcess();
        this.markExited(1);
    }

    protected abstract sendInput(data: string): void;

    protected abstract onDidResize(cols: number, rows: number): void;

    protected abstract disposeProcess(): void;

    protected abstract relaunchProcess(options: ITerminalRelaunchOptions): void;

    /**
     * `term.write()` is async: emitUpdate runs in the write callback, after buffer.active
     * is updated, otherwise the frame lags one event behind.
     */
    protected feedOutput(data: string): void {
        if (this.term === undefined) this.pendingOutput.push(data);
        else this.writeToTerm(this.term, data);
    }

    private writeToTerm(term: Terminal, data: string): void {
        term.write(data, () => {
            // New output returns the viewport to the bottom — otherwise the frame drifts against the growing baseY.
            this.viewportScrollOffset = 0;
            this.emitUpdate();
        });
    }

    protected markExited(exitCode: number): void {
        if (this.exited) return;
        this.exited = true;
        this.onExitEmitter.fire(exitCode);
    }

    public get isExited(): boolean {
        return this.exited;
    }

    /**
     * Upstream `reuseTerminal`: the previous output stays above (or is erased with `clear`). Call after the
     * previous process exits.
     */
    public relaunch(options: ITerminalRelaunchOptions): void {
        this.feedOutput(options.clear === true ? CLEAR_ALL : NEW_LINE_AT_START);
        if (options.message !== undefined) this.feedOutput(`${options.message}\r\n`);
        this.exited = false;
        this.relaunchProcess(options);
    }

    /** The buffer stores palette indices, so a change recolors already printed output too. */
    public setAnsiColors(ansi: readonly number[]): void {
        this.palette = buildXtermPalette(ansi);
        this.emitUpdate();
    }

    /** Text goes to the emulator as process output; it isn't sent to the process. */
    public printMessage(text: string): void {
        this.feedOutput(text);
    }

    /** Clamped on read: `baseY` can shrink (resize, clear) after scrolling up. */
    public get scrollOffset(): number {
        return Math.min(this.viewportScrollOffset, this.maxScrollOffset);
    }

    public get mouseEventsActive(): boolean {
        return this.term !== undefined && coreMouseService(this.term).areMouseEventsActive;
    }

    /** `delta < 0` scrolls up; clamped to `[0, baseY]`. */
    public scrollLines(delta: number): void {
        this.setScrollOffset(this.scrollOffset - delta);
    }

    /**
     * The row accounts for scrolling (`baseY - scrollOffset + y`). `false` for a wide-char continuation cell
     * (the head was already returned with width=2) or out of range; `out` is then untouched.
     */
    public readCell(x: number, y: number, out: TerminalCell): boolean {
        if (this.term === undefined) return false;
        const buffer = this.term.buffer.active;
        const line = buffer.getLine(buffer.baseY - this.scrollOffset + y);
        if (!line) return false;
        const cell = line.getCell(x, this.cellBuffer);
        if (!cell) return false;
        // Stryker disable next-line AssignmentExpression,ExpressionStatement: cell reuse only saves allocations
        this.cellBuffer = cell;
        const width = cell.getWidth();
        if (width === 0) return false;
        const chars = cell.getChars();
        out.char = chars.length > 0 ? chars : " ";
        out.fg = resolveFg(cell, this.palette);
        out.bg = resolveBg(cell, this.palette);
        out.style = resolveStyle(cell);
        out.width = width;
        return true;
    }

    /**
     * `null` in scrollback (the cursor lives at the bottom) and when the line is filled to the edge:
     * xterm keeps `cursorX` at exactly `cols` until the wrap.
     */
    public getCursor(): { x: number; y: number } | null {
        if (this.term === undefined || this.scrollOffset > 0) return null;
        const { cursorX: x, cursorY: y } = this.term.buffer.active;
        if (x >= this.cols) return null;
        return { x, y };
    }

    /** Any input returns the viewport to the bottom. */
    public write(data: string): void {
        this.setScrollOffset(0);
        if (this.exited) this.onDidInputAfterExitEmitter.fire();
        else this.sendInput(data);
    }

    public resize(cols: number, rows: number): void {
        if (cols <= 0 || rows <= 0) return;
        if (cols === this.cols && rows === this.rows) return;
        this.cols = cols;
        this.rows = rows;
        // Reflow changes the scrollback length; the `scrollOffset` getter clamps the offset.
        this.term?.resize(cols, rows);
        if (!this.exited) this.onDidResize(cols, rows);
    }

    /** The emulator decides whether and how to encode a report from the program's mouse mode; col/row are 0-based. */
    public sendMouse(event: TerminalMouseEventData): void {
        // No emulator yet — so no known mouse mode, nobody to send a report to.
        if (this.term === undefined) return;
        // After exit the emulator's report hits `write`, which doesn't send to a dead process.
        coreMouseService(this.term).triggerMouseEvent({
            col: event.col,
            row: event.row,
            button: mapButton(event.button),
            action: mapAction(event.action),
            ctrl: event.ctrl,
            alt: event.alt,
            shift: event.shift,
        });
    }

    public readonly onUpdate = this.onUpdateEmitter.event;

    public readonly onExit = this.onExitEmitter.event;

    /** Input after the process exits (the "press any key to close" key of `waitOnExit`). */
    public readonly onDidInputAfterExit = this.onDidInputAfterExitEmitter.event;

    public dispose(): void {
        this.disposed = true;
        this.disposeProcess();
        // Stryker disable next-line OptionalChaining,CallExpression: emulator disposal isn't observable from outside
        this.term?.dispose();
    }

    private emitUpdate(): void {
        this.onUpdateEmitter.fire();
    }

    private get maxScrollOffset(): number {
        return this.term?.buffer.active.baseY ?? 0;
    }

    private setScrollOffset(value: number): void {
        const next = Math.max(0, Math.min(value, this.maxScrollOffset));
        if (next === this.viewportScrollOffset) return;
        this.viewportScrollOffset = next;
        this.emitUpdate();
    }
}

function coreMouseService(term: Terminal): ICoreMouseService {
    // If xterm internals change, mouse tests fail instead of the wheel silently going dead.
    return (term as unknown as { _core: { coreMouseService: ICoreMouseService } })._core.coreMouseService;
}

function mapButton(button: TerminalMouseButton): number {
    return button === "wheel" ? WHEEL_BUTTON : CORE_BUTTON[button];
}

const CORE_ACTION: Readonly<Record<TerminalMouseAction, number>> = {
    down: ACTION_DOWN,
    up: ACTION_UP,
    move: ACTION_MOVE,
    wheelUp: WHEEL_ACTION.up,
    wheelDown: WHEEL_ACTION.down,
    wheelLeft: WHEEL_ACTION.left,
    wheelRight: WHEEL_ACTION.right,
};

function mapAction(action: TerminalMouseAction): number {
    return CORE_ACTION[action];
}

function resolveFg(cell: IBufferCell, palette: XtermPalette): number {
    if (cell.isFgDefault()) return DEFAULT_COLOR;
    if (cell.isFgRGB()) return cell.getFgColor(); // already 0xRRGGBB
    return xtermPaletteToRgb(cell.getFgColor(), palette); // palette index
}

function resolveBg(cell: IBufferCell, palette: XtermPalette): number {
    if (cell.isBgDefault()) return DEFAULT_COLOR;
    if (cell.isBgRGB()) return cell.getBgColor();
    return xtermPaletteToRgb(cell.getBgColor(), palette);
}

function resolveStyle(cell: IBufferCell): number {
    let style = StyleFlags.None;
    if (cell.isBold()) style |= StyleFlags.Bold;
    if (cell.isItalic()) style |= StyleFlags.Italic;
    if (cell.isUnderline()) style |= StyleFlags.Underline;
    if (cell.isDim()) style |= StyleFlags.Dim;
    if (cell.isInverse()) style |= StyleFlags.Inverse;
    if (cell.isStrikethrough()) style |= StyleFlags.Strikethrough;
    return style;
}
