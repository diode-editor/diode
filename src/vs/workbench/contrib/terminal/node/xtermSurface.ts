// VT-эмулятор встроенного терминала поверх @xterm/headless — общая половина
// двух сессий: шелл в настоящем PTY (`EmbeddedTerminalSession`) и pty
// расширения, чей процесс живёт в субпроцессе расширений
// (`ExtensionPtySession`). Здесь — всё, что про сетку ячеек: парсинг вывода в
// буфер, чтение ячеек и курсора (`ITerminalSurface`), скролбэк, мышь, ресайз
// эмулятора. Откуда берётся вывод и куда уходит ввод, решает наследник:
// `sendInput` (клавиши и ответы эмулятора — DSR/DA, отчёты мыши) и хуки
// `onDidResize`/`disposeProcess`.
//
// Сам @xterm/headless — ленивый кусок бандла (docs/arch/Common.md, «Ленивые
// куски бандла»): поверхность создаётся синхронно, а эмулятор появляется, когда
// кусок загрузился (как `_xtermReadyPromise` у `TerminalInstance` эталона). До
// этого вывод копится в очереди и уходит в эмулятор по порядку, ввод и ресайз
// идут в процесс сразу, а сетка читается пустой.

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

/** Новый процесс в переиспользуемом терминале начинается с новой строки (`'\n\x1b[G'` эталона). */
const NEW_LINE_AT_START = "\n\x1b[G";
/** Стереть экран и скролбэк, курсор — в начало (`presentation.clear` задачи). */
const CLEAR_ALL = "\x1b[2J\x1b[3J\x1b[H";

/**
 * Пространство имён `import()` над @xterm/headless — двух форм. CJS-сборка
 * (`main`, её же собирает ленивый кусок `loadLazyModule`): значения в `default`
 * (`module.exports`). ESM-сборка (поле `module` пакета — её берёт загрузчик tsx
 * при запуске из исходников): только именованные экспорты, `default` нет.
 */
export type XtermNamespace = { readonly default: typeof XtermModule } | typeof XtermModule;

/** Модуль xterm из пространства имён любой из двух форм ({@link XtermNamespace}). */
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
    // Эмулятор; `undefined`, пока кусок @xterm/headless не загрузился (или после отказа загрузки).
    private term: Terminal | undefined;
    // Вывод, пришедший до эмулятора, — уходит в него по порядку, когда тот появится.
    private readonly pendingOutput: string[] = [];
    private disposed = false;
    /**
     * Эмулятор появился (накопленный вывод ушёл в него) либо загрузка отказала —
     * никогда не отклоняется (`xtermReadyPromise` эталона).
     */
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
    // Во что разворачиваются palette-индексы ячеек; 16 системных задаёт `setAnsiColors`.
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

    /**
     * Кусок загрузился: эмулятор нынешнего размера (ресайз до загрузки уже ушёл
     * процессу и лёг в `cols`/`rows`), затем накопленный вывод — по порядку.
     */
    private attachTerminal(xterm: typeof XtermModule, scrollback: number): void {
        if (this.disposed) return;
        const term = new xterm.Terminal({ cols: this.cols, rows: this.rows, allowProposedApi: true, scrollback });
        // Ответы эмулятора (DSR/DA, отчёты мыши) → обратно в процесс: тот же путь, что и
        // пользовательский ввод, включая защиту от записи в уже мёртвый процесс.
        term.onData((data) => {
            this.write(data);
        });
        this.term = term;
        for (const data of this.pendingOutput.splice(0)) this.writeToTerm(term, data);
    }

    /**
     * Эмулятор не загрузился (битый кусок): показать вывод нечем, поэтому процесс
     * останавливаем, а сессия выходит с кодом 1 — терминал не висит пустым молча.
     */
    private failToLoad(error: unknown): void {
        onUnexpectedError(error);
        this.pendingOutput.length = 0;
        if (this.disposed) return;
        this.disposeProcess();
        this.markExited(1);
    }

    /** Куда уходят байты ввода (клавиши человека, ответы эмулятора), пока процесс жив. */
    protected abstract sendInput(data: string): void;

    /** Размер эмулятора изменился — наследник передаёт его процессу (TIOCSWINSZ / setDimensions). */
    protected abstract onDidResize(cols: number, rows: number): void;

    /** Освобождение процесса наследника при dispose (убить PTY и т.п.). */
    protected abstract disposeProcess(): void;

    /** Запустить новый процесс вместо вышедшего (см. {@link relaunch}). */
    protected abstract relaunchProcess(options: ITerminalRelaunchOptions): void;

    /**
     * Вывод процесса → эмулятор → сигнал перерисовки контролу.
     * ВАЖНО: term.write() асинхронный (парсер обрабатывает буфер отложенно), поэтому
     * emitUpdate дёргаем в write-колбэке — ПОСЛЕ обновления buffer.active. Иначе рендер
     * читает устаревшее состояние, и картинка отстаёт на одно событие («залипание»).
     */
    protected feedOutput(data: string): void {
        if (this.term === undefined) this.pendingOutput.push(data);
        else this.writeToTerm(this.term, data);
    }

    private writeToTerm(term: Terminal, data: string): void {
        term.write(data, () => {
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
     * Новый процесс в том же эмуляторе (`reuseTerminal` эталона): вывод прежнего
     * остаётся выше — новый начнётся с новой строки — либо стирается целиком
     * при `clear` (экран и скролбэк); `message` печатается перед выводом нового
     * процесса. Звать после выхода прежнего.
     */
    public relaunch(options: ITerminalRelaunchOptions): void {
        this.feedOutput(options.clear === true ? CLEAR_ALL : NEW_LINE_AT_START);
        if (options.message !== undefined) this.feedOutput(`${options.message}\r\n`);
        this.exited = false;
        this.relaunchProcess(options);
    }

    /**
     * 16 ANSI-цветов (индексы 0..15), в которые разворачиваются palette-ячейки, — из
     * темы или хост-терминала. Буфер эмулятора хранит индексы, поэтому смена
     * перекрашивает и уже выведенное: дёргаем перерисовку.
     */
    public setAnsiColors(ansi: readonly number[]): void {
        this.palette = buildXtermPalette(ansi);
        this.emitUpdate();
    }

    /** Текст в эмулятор как вывод процесса; в сам процесс не уходит. */
    public printMessage(text: string): void {
        this.feedOutput(text);
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
        return this.term !== undefined && coreMouseService(this.term).areMouseEventsActive;
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
        if (this.term === undefined) return false;
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
        out.fg = resolveFg(cell, this.palette);
        out.bg = resolveBg(cell, this.palette);
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
        if (this.term === undefined || this.scrollOffset > 0) return null;
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
        if (this.exited) this.onDidInputAfterExitEmitter.fire();
        else this.sendInput(data);
    }

    /** Синхронный ресайз эмулятора (и процесса — через `onDidResize`); no-op при совпадении. */
    public resize(cols: number, rows: number): void {
        if (cols <= 0 || rows <= 0) return;
        if (cols === this.cols && rows === this.rows) return;
        this.cols = cols;
        this.rows = rows;
        // Рефлоу меняет длину скролбэка; смещение клампит геттер `scrollOffset`.
        this.term?.resize(cols, rows);
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

    /** Сколько строк истории лежит выше вьюпорта — максимум, на который можно уехать. */
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

/**
 * coreMouseService — внутренний (не публичный) сервис xterm; ходим к нему напрямую,
 * поэтому доступ спрятан в одно место.
 */
function coreMouseService(term: Terminal): ICoreMouseService {
    // Сменятся внутренности xterm — упадут тесты мыши, а не тихо погаснет колесо.
    return (term as unknown as { _core: { coreMouseService: ICoreMouseService } })._core.coreMouseService;
}

/** Семантическая кнопка → числовой CoreMouseButton xterm. */
function mapButton(button: TerminalMouseButton): number {
    return button === "wheel" ? WHEEL_BUTTON : CORE_BUTTON[button];
}

/** Семантическое действие → числовой CoreMouseAction xterm (таблица тотальна по типу). */
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
