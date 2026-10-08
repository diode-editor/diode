// VT-эмулятор встроенного терминала поверх @xterm/headless — общая половина
// двух сессий: шелл в настоящем PTY (`EmbeddedTerminalSession`) и pty
// расширения, чей процесс живёт в субпроцессе расширений
// (`ExtensionPtySession`). Здесь — всё, что про сетку ячеек: парсинг вывода в
// буфер, чтение ячеек и курсора (`ITerminalSurface`), скролбэк, мышь, ресайз
// эмулятора. Откуда берётся вывод и куда уходит ввод, решает наследник:
// `sendInput` (клавиши и ответы эмулятора — DSR/DA, отчёты мыши) и хуки
// `onDidResize`/`disposeProcess`.

import { DEFAULT_COLOR } from "@tuidom/core/common/colorUtils";
import type {
    ITerminalSurface,
    TerminalCell,
    TerminalMouseAction,
    TerminalMouseButton,
    TerminalMouseEventData,
} from "@tuidom/core/common/iTerminalSurface";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { IBufferCell, Terminal } from "@xterm/headless";
// @xterm/headless — CJS-пакет: под нативным ESM-загрузчиком (tsx/esm) named-import
// не работает в рантайме, поэтому берём значение default-импортом, а тип — отдельно.
import xtermHeadless from "@xterm/headless";

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { xtermPaletteToRgb } from "../common/xtermPalette.ts";

/** Событие для внутреннего coreMouseService xterm (значения enum-ов — как в xterm). */
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
    /** Включила ли программа хоть один mouse-режим (?1000/?1002/?1003…). */
    readonly areMouseEventsActive: boolean;
}

// xterm CoreMouseButton / CoreMouseAction (значения enum-ов). Семантические строки
// `ITerminalSurface` разворачиваем в эти числа именно здесь — виджет не знает про xterm.
// Тип ключей точный (а не Record<string, …>) — тогда индексация тотальна и не нужен
// недостижимый фоллбэк на случай «неизвестной» кнопки.
const CORE_BUTTON: Record<Exclude<TerminalMouseButton, "wheel">, number> = { left: 0, middle: 1, right: 2, none: 3 };
const WHEEL_BUTTON = 4;
const ACTION_UP = 0;
const ACTION_DOWN = 1;
// MOVE — именно 32, а не следующий по порядку 4: в xterm это бит «motion», который
// кодировщик подмешивает в кнопку. С 4 эмулятор глушил move целиком (`button===NONE`
// допустим только с `action===MOVE`), а drag кодировал как повторное нажатие левой.
const ACTION_MOVE = 32;
const WHEEL_ACTION: Record<"up" | "down" | "left" | "right", number> = { up: 0, down: 1, left: 2, right: 3 };

export interface XtermSurfaceOptions {
    cols: number;
    rows: number;
    scrollback?: number;
}

export abstract class XtermSurface implements ITerminalSurface, IDisposable {
    protected readonly term: Terminal;
    private readonly onUpdateEmitter = new Emitter<void>();
    private readonly onExitEmitter = new Emitter<number>();
    // Переиспользуемая ячейка — getCell(x, cell) не аллоцирует новый объект на каждую ячейку.
    private cellBuffer: IBufferCell | undefined;
    protected cols: number;
    protected rows: number;
    private exited = false;
    // Смещение вьюпорта в скролбэк, в строках вверх от дна (0 = живой вывод).
    private viewportScrollOffset = 0;

    protected constructor(options: XtermSurfaceOptions) {
        this.cols = options.cols;
        this.rows = options.rows;
        this.term = new xtermHeadless.Terminal({
            cols: this.cols,
            rows: this.rows,
            allowProposedApi: true,
            scrollback: options.scrollback ?? 1000,
        });
        // Ответы эмулятора (DSR/DA, отчёты мыши) → обратно в процесс: тот же путь, что и
        // пользовательский ввод, включая защиту от записи в уже мёртвый процесс.
        this.term.onData((data) => {
            this.write(data);
        });
    }

    /** Куда уходят байты ввода (клавиши человека, ответы эмулятора), пока процесс жив. */
    protected abstract sendInput(data: string): void;

    /** Размер эмулятора изменился — наследник передаёт его процессу (TIOCSWINSZ / setDimensions). */
    protected abstract onDidResize(cols: number, rows: number): void;

    /** Освобождение процесса наследника при dispose (убить PTY и т.п.). */
    protected abstract disposeProcess(): void;

    /**
     * Вывод процесса → эмулятор → сигнал перерисовки контролу.
     * ВАЖНО: term.write() асинхронный (парсер обрабатывает буфер отложенно), поэтому
     * emitUpdate дёргаем в write-колбэке — ПОСЛЕ обновления buffer.active. Иначе рендер
     * читает устаревшее состояние, и картинка отстаёт на одно событие («залипание»).
     */
    protected feedOutput(data: string): void {
        this.term.write(data, () => {
            // Новый вывод возвращает вьюпорт на дно — иначе картинка «уезжает»
            // относительно растущего baseY и превращается в кашу.
            this.viewportScrollOffset = 0;
            this.emitUpdate();
        });
    }

    /** Процесс завершился: ввод больше не принимается, подписчики `onExit` получают код. */
    protected markExited(exitCode: number): void {
        if (this.exited) return;
        this.exited = true;
        this.onExitEmitter.fire(exitCode);
    }

    public get isExited(): boolean {
        return this.exited;
    }

    /**
     * Смещение вьюпорта в скролбэк, в строках. Клампим на чтении: `baseY` живой и может
     * уменьшиться (ресайз, clear) уже после того, как пользователь прокрутил вверх.
     */
    public get scrollOffset(): number {
        return Math.min(this.viewportScrollOffset, this.maxScrollOffset);
    }

    /** Включила ли программа в шелле mouse-tracking — тогда колесо принадлежит ей. */
    public get mouseEventsActive(): boolean {
        return this.coreMouseService.areMouseEventsActive;
    }

    /**
     * Прокрутить вьюпорт по скролбэку: `delta < 0` — вверх, `delta > 0` — вниз.
     * Клампится в `[0, baseY]`; при реальном изменении дёргает `onUpdate`.
     */
    public scrollLines(delta: number): void {
        this.setScrollOffset(this.scrollOffset - delta);
    }

    /**
     * Прочитать ячейку вьюпорта в переданный `out`. Строка берётся с учётом смещения
     * прокрутки (`baseY - scrollOffset + y`), поэтому в скролбэке рисуется история.
     * Возвращает false для continuation-ячейки wide-char (`getWidth() === 0` — голова
     * уже отдана с width=2) либо координаты вне диапазона; в обоих случаях `out` не тронут.
     */
    public readCell(x: number, y: number, out: TerminalCell): boolean {
        const buffer = this.term.buffer.active;
        const line = buffer.getLine(buffer.baseY - this.scrollOffset + y);
        if (!line) return false;
        const cell = line.getCell(x, this.cellBuffer);
        if (!cell) return false;
        // Stryker disable next-line AssignmentExpression,ExpressionStatement: кэш переиспользуемой ячейки — без него только лишние аллокации, результат тот же
        this.cellBuffer = cell;
        const width = cell.getWidth();
        if (width === 0) return false; // продолжение wide-char
        const chars = cell.getChars();
        out.char = chars.length > 0 ? chars : " ";
        out.fg = resolveFg(cell);
        out.bg = resolveBg(cell);
        out.style = resolveStyle(cell);
        out.width = width;
        return true;
    }

    /**
     * Позиция курсора в видимой области или `null`, когда мы смотрим в скролбэк
     * (курсор живёт на дне — над историей он врёт) или строка дописана до края:
     * xterm держит `cursorY` в `[0, rows)`, а `cursorX` до переноса — ровно `cols`.
     */
    public getCursor(): { x: number; y: number } | null {
        if (this.scrollOffset > 0) return null;
        const { cursorX: x, cursorY: y } = this.term.buffer.active;
        if (x >= this.cols) return null;
        return { x, y };
    }

    /**
     * Ввод пользователя (уже закодированный в байты, которые ждёт процесс). Любой ввод
     * возвращает вьюпорт на дно — печатать, глядя в историю, бессмысленно.
     */
    public write(data: string): void {
        this.setScrollOffset(0);
        if (!this.exited) this.sendInput(data);
    }

    /** Синхронный ресайз эмулятора (и процесса — через `onDidResize`); no-op при совпадении. */
    public resize(cols: number, rows: number): void {
        if (cols <= 0 || rows <= 0) return;
        if (cols === this.cols && rows === this.rows) return;
        this.cols = cols;
        this.rows = rows;
        // Рефлоу меняет длину скролбэка; смещение клампит геттер `scrollOffset`.
        this.term.resize(cols, rows);
        if (!this.exited) this.onDidResize(cols, rows);
    }

    /**
     * Пробросить событие мыши во внутренний VT-эмулятор. Он сам решит (по активному
     * mouse-режиму, который включила программа в шелле — htop/vim/tmux) слать ли отчёт
     * и в какой кодировке (X10/SGR); закодированная последовательность уходит в процесс
     * через уже подключённый term.onData. Семантические button/action разворачиваем в
     * числовые enum-ы xterm.
     *
     * coreMouseService — внутренний (не публичный) сервис xterm; обращаемся к нему
     * напрямую. Координаты col/row — 0-based (как их отдал виджет).
     */
    public sendMouse(event: TerminalMouseEventData): void {
        // После выхода отчёт эмулятора упрётся в `write`, который мёртвому процессу не шлёт.
        this.coreMouseService.triggerMouseEvent({
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

    public dispose(): void {
        this.disposeProcess();
        // Stryker disable next-line ExpressionStatement: освобождение ресурсов эмулятора снаружи не наблюдается
        this.term.dispose();
    }

    private emitUpdate(): void {
        this.onUpdateEmitter.fire();
    }

    /** Сколько строк истории лежит выше вьюпорта — максимум, на который можно уехать. */
    private get maxScrollOffset(): number {
        return this.term.buffer.active.baseY;
    }

    /**
     * coreMouseService — внутренний (не публичный) сервис xterm; ходим к нему напрямую,
     * поэтому доступ спрятан в одно место.
     */
    private get coreMouseService(): ICoreMouseService {
        // Сменятся внутренности xterm — упадут тесты мыши, а не тихо погаснет колесо.
        return (this.term as unknown as { _core: { coreMouseService: ICoreMouseService } })._core.coreMouseService;
    }

    private setScrollOffset(value: number): void {
        const next = Math.max(0, Math.min(value, this.maxScrollOffset));
        if (next === this.viewportScrollOffset) return;
        this.viewportScrollOffset = next;
        this.emitUpdate();
    }
}

/** Семантическая кнопка → числовой CoreMouseButton xterm. */
function mapButton(button: TerminalMouseButton): number {
    return button === "wheel" ? WHEEL_BUTTON : CORE_BUTTON[button];
}

/** Семантическое действие → числовой CoreMouseAction xterm. */
function mapAction(action: TerminalMouseAction): number {
    switch (action) {
        case "down":
            return ACTION_DOWN;
        case "up":
            return ACTION_UP;
        case "move":
            return ACTION_MOVE;
        case "wheelUp":
            return WHEEL_ACTION.up;
        case "wheelDown":
            return WHEEL_ACTION.down;
        case "wheelLeft":
            return WHEEL_ACTION.left;
        case "wheelRight":
            return WHEEL_ACTION.right;
    }
}

function resolveFg(cell: IBufferCell): number {
    if (cell.isFgDefault()) return DEFAULT_COLOR;
    if (cell.isFgRGB()) return cell.getFgColor(); // уже 0xRRGGBB
    return xtermPaletteToRgb(cell.getFgColor()); // palette-индекс
}

function resolveBg(cell: IBufferCell): number {
    if (cell.isBgDefault()) return DEFAULT_COLOR;
    if (cell.isBgRGB()) return cell.getBgColor();
    return xtermPaletteToRgb(cell.getBgColor());
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
