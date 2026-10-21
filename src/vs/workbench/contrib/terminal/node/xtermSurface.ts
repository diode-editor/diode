// VT-эмулятор поверх @xterm/headless — общая половина `EmbeddedTerminalSession` и
// `ExtensionPtySession`; откуда вывод и куда ввод, решает наследник. @xterm/headless —
// ленивый кусок бандла (как `_xtermReadyPromise` эталона): до загрузки вывод копится
// в очереди, ввод и ресайз идут в процесс сразу, сетка читается пустой.

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

// Значения enum-ов xterm CoreMouseButton/CoreMouseAction: виджет про xterm не знает.
const CORE_BUTTON: Record<Exclude<TerminalMouseButton, "wheel">, number> = { left: 0, middle: 1, right: 2, none: 3 };
const WHEEL_BUTTON = 4;
const ACTION_UP = 0;
const ACTION_DOWN = 1;
// MOVE — 32, а не 4: в xterm это бит «motion», подмешиваемый в кнопку; с 4 эмулятор
// глушил move, а drag кодировал как повторное нажатие левой.
const ACTION_MOVE = 32;
const WHEEL_ACTION: Record<"up" | "down" | "left" | "right", number> = { up: 0, down: 1, left: 2, right: 3 };

/** Новый процесс в переиспользуемом терминале начинается с новой строки (`'\n\x1b[G'` эталона). */
const NEW_LINE_AT_START = "\n\x1b[G";
/** Стереть экран и скролбэк, курсор — в начало (`presentation.clear` задачи). */
const CLEAR_ALL = "\x1b[2J\x1b[3J\x1b[H";

/**
 * CJS-сборка (ленивый кусок) кладёт значения в `default`; ESM (загрузчик tsx из
 * исходников) — только именованные экспорты.
 */
export type XtermNamespace = { readonly default: typeof XtermModule } | typeof XtermModule;

export function xtermModuleOf(namespace: XtermNamespace): typeof XtermModule {
    return "default" in namespace ? namespace.default : namespace;
}

/** @xterm/headless — ленивый кусок: грузится при первой сессии терминала, не на старте. */
export function loadXterm(): Promise<XtermNamespace> {
    return importLazyModule("@xterm/headless", () => import("@xterm/headless") as Promise<XtermNamespace>);
}

export interface XtermSurfaceOptions {
    cols: number;
    rows: number;
    scrollback?: number;
}

export abstract class XtermSurface implements ITerminalSurface, IDisposable {
    // `undefined` до загрузки куска и после отказа загрузки.
    private term: Terminal | undefined;
    private readonly pendingOutput: string[] = [];
    private disposed = false;
    /** Никогда не отклоняется: резолвится и при отказе загрузки (`xtermReadyPromise` эталона). */
    public readonly xtermReady: Promise<void>;
    private readonly onUpdateEmitter = new Emitter<void>();
    private readonly onExitEmitter = new Emitter<number>();
    private readonly onDidInputAfterExitEmitter = new Emitter<void>();
    // Переиспользуемая ячейка — getCell(x, cell) не аллоцирует новый объект на каждую ячейку.
    private cellBuffer: IBufferCell | undefined;
    protected cols: number;
    protected rows: number;
    private exited = false;
    // Смещение вьюпорта в скролбэк, в строках вверх от дна (0 = живой вывод).
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

    /** Ресайз до загрузки уже ушёл процессу и лёг в `cols`/`rows`. */
    private attachTerminal(xterm: typeof XtermModule, scrollback: number): void {
        if (this.disposed) return;
        const term = new xterm.Terminal({ cols: this.cols, rows: this.rows, allowProposedApi: true, scrollback });
        // Ответы эмулятора (DSR/DA, отчёты мыши) — тем же путём, что ввод, с защитой от мёртвого процесса.
        term.onData((data) => {
            this.write(data);
        });
        this.term = term;
        for (const data of this.pendingOutput.splice(0)) this.writeToTerm(term, data);
    }

    /** Битый кусок: процесс останавливаем, сессия выходит с кодом 1 — терминал не висит пустым молча. */
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
     * `term.write()` асинхронный: emitUpdate — в write-колбэке, после обновления
     * buffer.active, иначе картинка отстаёт на одно событие.
     */
    protected feedOutput(data: string): void {
        if (this.term === undefined) this.pendingOutput.push(data);
        else this.writeToTerm(this.term, data);
    }

    private writeToTerm(term: Terminal, data: string): void {
        term.write(data, () => {
            // Новый вывод возвращает вьюпорт на дно — иначе картинка уезжает относительно растущего baseY.
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

    /** `reuseTerminal` эталона: вывод прежнего остаётся выше (или стирается при `clear`). Звать после выхода прежнего. */
    public relaunch(options: ITerminalRelaunchOptions): void {
        this.feedOutput(options.clear === true ? CLEAR_ALL : NEW_LINE_AT_START);
        if (options.message !== undefined) this.feedOutput(`${options.message}\r\n`);
        this.exited = false;
        this.relaunchProcess(options);
    }

    /** Буфер хранит palette-индексы, поэтому смена перекрашивает и уже выведенное. */
    public setAnsiColors(ansi: readonly number[]): void {
        this.palette = buildXtermPalette(ansi);
        this.emitUpdate();
    }

    /** Текст в эмулятор как вывод процесса; в сам процесс не уходит. */
    public printMessage(text: string): void {
        this.feedOutput(text);
    }

    /** Клампим на чтении: `baseY` может уменьшиться (ресайз, clear) после прокрутки вверх. */
    public get scrollOffset(): number {
        return Math.min(this.viewportScrollOffset, this.maxScrollOffset);
    }

    public get mouseEventsActive(): boolean {
        return this.term !== undefined && coreMouseService(this.term).areMouseEventsActive;
    }

    /** `delta < 0` — вверх; клампится в `[0, baseY]`. */
    public scrollLines(delta: number): void {
        this.setScrollOffset(this.scrollOffset - delta);
    }

    /**
     * Строка — с учётом прокрутки (`baseY - scrollOffset + y`). `false` — continuation-ячейка
     * wide-char (голова уже отдана с width=2) или вне диапазона; `out` тогда не тронут.
     */
    public readCell(x: number, y: number, out: TerminalCell): boolean {
        if (this.term === undefined) return false;
        const buffer = this.term.buffer.active;
        const line = buffer.getLine(buffer.baseY - this.scrollOffset + y);
        if (!line) return false;
        const cell = line.getCell(x, this.cellBuffer);
        if (!cell) return false;
        // Stryker disable next-line AssignmentExpression,ExpressionStatement: кэш переиспользуемой ячейки — без него только лишние аллокации, результат тот же
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
     * `null` в скролбэке (курсор живёт на дне) и когда строка дописана до края:
     * xterm держит `cursorX` до переноса ровно `cols`.
     */
    public getCursor(): { x: number; y: number } | null {
        if (this.term === undefined || this.scrollOffset > 0) return null;
        const { cursorX: x, cursorY: y } = this.term.buffer.active;
        if (x >= this.cols) return null;
        return { x, y };
    }

    /** Любой ввод возвращает вьюпорт на дно. */
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
        // Рефлоу меняет длину скролбэка; смещение клампит геттер `scrollOffset`.
        this.term?.resize(cols, rows);
        if (!this.exited) this.onDidResize(cols, rows);
    }

    /** Слать ли отчёт и в какой кодировке, решает эмулятор по mouse-режиму программы; col/row 0-based. */
    public sendMouse(event: TerminalMouseEventData): void {
        // Эмулятора ещё нет — не знает и mouse-режима программы, отчёт слать некому.
        if (this.term === undefined) return;
        // После выхода отчёт эмулятора упрётся в `write`, который мёртвому процессу не шлёт.
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

    /** Ввод после выхода процесса (клавиша «press any key to close» у `waitOnExit`). */
    public readonly onDidInputAfterExit = this.onDidInputAfterExitEmitter.event;

    public dispose(): void {
        this.disposed = true;
        this.disposeProcess();
        // Stryker disable next-line OptionalChaining,CallExpression: освобождение ресурсов эмулятора снаружи не наблюдается
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
    // Сменятся внутренности xterm — упадут тесты мыши, а не тихо погаснет колесо.
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
    if (cell.isFgRGB()) return cell.getFgColor(); // уже 0xRRGGBB
    return xtermPaletteToRgb(cell.getFgColor(), palette); // palette-индекс
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
