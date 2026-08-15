// Связка node-pty ↔ @xterm/headless — «сервер» встроенного терминала.
//
// Держит реальную PTY-пару (node-pty: ядро выдаёт настоящий TTY → интерактивность)
// и VT-эмулятор (@xterm/headless: парсит вывод шелла в сетку ячеек, читаемую через
// `terminal.buffer.active`). Наружу торчит контракт `ITerminalSurface`: прочитать
// ячейку (`readCell`), позицию курсора (`getCursor`), подать ввод (`write`), мышь
// (`sendMouse`), сменить размер (`resize`), подписаться на «есть новые данные»
// (`onUpdate`) и на выход шелла (`onExit`).
//
// Это Workbench-слой (выше TUIDom), поэтому импорт node-pty здесь допустим: слои
// TUIDom и ниже остаются чистыми, а виджет `TerminalViewElement` видит только
// `ITerminalSurface`. См. docs/TODO/IntegratedTerminal.md.

import type { IBufferCell, Terminal } from "@xterm/headless";
// @xterm/headless — CJS-пакет: под нативным ESM-загрузчиком (tsx/esm) named-import
// не работает в рантайме, поэтому берём значение default-импортом, а тип — отдельно.
import xtermHeadless from "@xterm/headless";
import type { IPty } from "node-pty";

import { DEFAULT_COLOR } from "@tuidom/core/common/colorUtils";
import type { IDisposable } from "@tuidom/core/common/disposable";
import type {
    ITerminalSurface,
    TerminalCell,
    TerminalMouseAction,
    TerminalMouseButton,
    TerminalMouseEventData,
} from "@tuidom/core/common/iTerminalSurface";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { xtermPaletteToRgb } from "../common/xtermPalette.ts";

import { loadNodePty } from "./loadNodePty.ts";

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

export interface EmbeddedTerminalOptions {
    cols: number;
    rows: number;
    shell?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    scrollback?: number;
}

/** Отфильтровать `undefined`-значения из process.env (node-pty ждёт `Record<string,string>`). */
function currentEnv(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        /* v8 ignore start -- process.env never yields an undefined value (deleting a key removes the entry entirely), so the else path is unreachable; the guard exists only to satisfy the `string | undefined` type of ProcessEnv */
        if (value !== undefined) out[key] = value;
        /* v8 ignore stop */
    }
    return out;
}

export class EmbeddedTerminalSession implements ITerminalSurface, IDisposable {
    private readonly pty: IPty;
    private readonly term: Terminal;
    private readonly updateListeners = new Set<() => void>();
    private readonly exitListeners = new Set<(exitCode: number) => void>();
    // Переиспользуемая ячейка — getCell(x, cell) не аллоцирует новый объект на каждую ячейку.
    private cellBuffer: IBufferCell | undefined;
    private cols: number;
    private rows: number;
    private exited = false;
    // Смещение вьюпорта в скролбэк, в строках вверх от дна (0 = живой вывод).
    private viewportScrollOffset = 0;

    public constructor(options: EmbeddedTerminalOptions) {
        this.cols = options.cols;
        this.rows = options.rows;

        const shell = options.shell ?? process.env.SHELL ?? "bash";
        const env: Record<string, string> = {
            ...currentEnv(),
            ...(options.env ?? {}),
            TERM: "xterm-256color",
            // Внутри собственного tmux-хоста $TMUX сбивает детект — убираем для чистоты.
        };
        delete env.TMUX;
        // win32 использовал бы COMSPEC вместо $SHELL — вне scope пока (только *nix).

        this.term = new xtermHeadless.Terminal({
            cols: this.cols,
            rows: this.rows,
            allowProposedApi: true,
            scrollback: options.scrollback ?? 1000,
        });

        const { spawn } = loadNodePty();
        this.pty = spawn(shell, options.args ?? [], {
            name: "xterm-256color",
            cols: this.cols,
            rows: this.rows,
            cwd: options.cwd ?? process.cwd(),
            env,
        });

        // Вывод шелла → эмулятор → сигнал перерисовки контролу.
        // ВАЖНО: term.write() асинхронный (парсер обрабатывает буфер отложенно), поэтому
        // emitUpdate дёргаем в write-колбэке — ПОСЛЕ обновления buffer.active. Иначе рендер
        // читает устаревшее состояние, и картинка отстаёт на одно событие («залипание»).
        this.pty.onData((data) => {
            this.term.write(data, () => {
                // Новый вывод возвращает вьюпорт на дно — иначе картинка «уезжает»
                // относительно растущего baseY и превращается в кашу.
                this.viewportScrollOffset = 0;
                this.emitUpdate();
            });
        });
        // Ответы эмулятора (DSR/DA, отчёты мыши) → обратно в шелл: тот же путь, что и
        // пользовательский ввод, включая защиту от записи в уже мёртвый PTY.
        this.term.onData((data) => {
            this.write(data);
        });
        this.pty.onExit(({ exitCode }) => {
            this.exited = true;
            for (const cb of this.exitListeners) cb(exitCode);
        });
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
        const service = this.coreMouseService;
        /* v8 ignore start -- defensive: a live xterm Terminal always exposes _core.coreMouseService, so this guard is only a safety net against a change in xterm internals */
        if (!service) return false;
        /* v8 ignore stop */
        return service.areMouseEventsActive;
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
        if (cell) this.cellBuffer = cell;
        if (!cell) return false;
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
     * Позиция курсора в видимой области или `null`, когда координата вне диапазона
     * либо мы смотрим в скролбэк (курсор живёт на дне — над историей он врёт).
     */
    public getCursor(): { x: number; y: number } | null {
        if (this.scrollOffset > 0) return null;
        const buffer = this.term.buffer.active;
        const x = buffer.cursorX;
        const y = buffer.cursorY;
        if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return null;
        return { x, y };
    }

    /**
     * Ввод пользователя (уже закодированный в байты, которые ждёт PTY). Любой ввод
     * возвращает вьюпорт на дно — печатать, глядя в историю, бессмысленно.
     */
    public write(data: string): void {
        this.setScrollOffset(0);
        if (!this.exited) this.pty.write(data);
    }

    /** Синхронный ресайз PTY (TIOCSWINSZ+SIGWINCH) и эмулятора; no-op при совпадении. */
    public resize(cols: number, rows: number): void {
        if (cols <= 0 || rows <= 0) return;
        if (cols === this.cols && rows === this.rows) return;
        this.cols = cols;
        this.rows = rows;
        this.term.resize(cols, rows);
        // Рефлоу меняет длину скролбэка — подрезаем смещение под новый максимум.
        this.setScrollOffset(this.scrollOffset);
        if (!this.exited) this.pty.resize(cols, rows);
    }

    /**
     * Пробросить событие мыши во внутренний VT-эмулятор. Он сам решит (по активному
     * mouse-режиму, который включила программа в шелле — htop/vim/tmux) слать ли отчёт
     * и в какой кодировке (X10/SGR); закодированная последовательность уходит в PTY через
     * уже подключённый term.onData. Семантические button/action разворачиваем в числовые
     * enum-ы xterm.
     *
     * coreMouseService — внутренний (не публичный) сервис xterm; обращаемся к нему
     * напрямую. Координаты col/row — 0-based (как их отдал виджет).
     */
    public sendMouse(event: TerminalMouseEventData): void {
        if (this.exited) return;
        const service = this.coreMouseService;
        /* v8 ignore start -- defensive: a live xterm Terminal always exposes _core.coreMouseService, so the optional chain and this guard are only a safety net against a change in xterm internals */
        if (!service) return;
        /* v8 ignore stop */
        service.triggerMouseEvent({
            col: event.col,
            row: event.row,
            button: mapButton(event.button),
            action: mapAction(event.action),
            ctrl: event.ctrl,
            alt: event.alt,
            shift: event.shift,
        });
    }

    public onUpdate(callback: () => void): IDisposable {
        this.updateListeners.add(callback);
        return { dispose: () => this.updateListeners.delete(callback) };
    }

    public onExit(callback: (exitCode: number) => void): IDisposable {
        this.exitListeners.add(callback);
        return { dispose: () => this.exitListeners.delete(callback) };
    }

    public dispose(): void {
        if (!this.exited) {
            try {
                this.pty.kill();
            } catch {
                // процесс мог уже завершиться
            }
        }
        this.term.dispose();
    }

    private emitUpdate(): void {
        for (const cb of this.updateListeners) cb();
    }

    /** Сколько строк истории лежит выше вьюпорта — максимум, на который можно уехать. */
    private get maxScrollOffset(): number {
        return this.term.buffer.active.baseY;
    }

    /**
     * coreMouseService — внутренний (не публичный) сервис xterm; ходим к нему напрямую,
     * поэтому доступ спрятан в одно место.
     */
    private get coreMouseService(): ICoreMouseService | undefined {
        return (this.term as unknown as { _core?: { coreMouseService?: ICoreMouseService } })._core?.coreMouseService;
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
