import { DEFAULT_COLOR } from "../common/colorUtils.ts";
import type { IDisposable } from "../common/disposable.ts";
import type { ITerminalSurface, TerminalCell, TerminalMouseEventData } from "../common/iTerminalSurface.ts";

// Внутреннее представление ячейки в скриптованной сетке фейка.
interface FakeCell {
    char: string;
    fg: number;
    bg: number;
    style: number;
    width: number;
}

// Слот сетки: ячейка, "continuation" (правая половина wide-char) или undefined (пусто).
type FakeSlot = FakeCell | "continuation" | undefined;

export interface FakeCellOptions {
    fg?: number;
    bg?: number;
    style?: number;
    width?: number; // 1 | 2; при 2 следующий столбец помечается как continuation
}

/**
 * Скриптованная реализация {@link ITerminalSurface} для тестов `TerminalViewElement`.
 * Сетку задаём построчно (`setGrid`) или поячеечно (`setCell` — для цветов/стилей/wide-char),
 * курсор — `setCursor`, флаг выхода — `isExited`. Все обращения виджета наружу
 * (`write`/`sendMouse`/`resize`) пишутся в публичные массивы для ассертов, а `onUpdate`/
 * `onExit` дёргаются вручную через `emitUpdate`/`emitExit`.
 *
 * Прокрутка смоделирована состоянием, а не историей: `scrollbackLines` задаёт потолок
 * для `scrollLines`, а `scrollOffset` можно проверять напрямую. Сетка — это всегда
 * вьюпорт как он есть, смещение её не двигает (настоящий сдвиг строк проверяется на
 * `EmbeddedTerminalSession`).
 */
export class FakeTerminalSurface implements ITerminalSurface, IDisposable {
    private grid: FakeSlot[][] = [];
    private cursor: { x: number; y: number } | null = null;
    private readonly updateListeners = new Set<() => void>();
    private readonly exitListeners = new Set<(exitCode: number) => void>();

    public isExited = false;
    /** Включила ли «программа в шелле» mouse-tracking — от этого зависит судьба колеса. */
    public mouseEventsActive = false;
    /** Сколько строк истории лежит выше вьюпорта: потолок для `scrollLines`. */
    public scrollbackLines = 0;
    public scrollOffset = 0;
    /** Стал ли фейк «убитым» — контроллер обязан звать dispose() при закрытии терминала. */
    public disposed = false;

    // Записи обращений виджета — для ассертов.
    public readonly writes: string[] = [];
    public readonly mouseEvents: TerminalMouseEventData[] = [];
    public readonly resizes: { cols: number; rows: number }[] = [];

    /** Заполнить сетку строками текста (каждый символ — обычная ячейка ширины 1). */
    public setGrid(lines: string[]): void {
        this.grid = lines.map((line) => Array.from(line, (char) => makeCell(char)));
    }

    /**
     * Задать одну ячейку — здесь навешиваем цвета/стиль/ширину. При `width === 2`
     * правый сосед (`x + 1`) помечается как continuation (readCell вернёт там false).
     */
    public setCell(x: number, y: number, char: string, options: FakeCellOptions = {}): void {
        const row = this.ensureRow(y);
        const width = options.width ?? 1;
        row[x] = {
            char,
            fg: options.fg ?? DEFAULT_COLOR,
            bg: options.bg ?? DEFAULT_COLOR,
            style: options.style ?? 0,
            width,
        };
        if (width === 2) row[x + 1] = "continuation";
    }

    public setCursor(cursor: { x: number; y: number } | null): void {
        this.cursor = cursor;
    }

    /** Дёрнуть подписчиков onUpdate (эмуляция «пришли новые данные из шелла»). */
    public emitUpdate(): void {
        for (const cb of this.updateListeners) cb();
    }

    /** Дёрнуть подписчиков onExit (эмуляция выхода шелла). */
    public emitExit(exitCode: number): void {
        this.isExited = true;
        for (const cb of this.exitListeners) cb(exitCode);
    }

    // ─── ITerminalSurface ───

    public readCell(x: number, y: number, out: TerminalCell): boolean {
        const slot = this.grid[y]?.[x];
        if (slot === undefined || slot === "continuation") return false;
        out.char = slot.char;
        out.fg = slot.fg;
        out.bg = slot.bg;
        out.style = slot.style;
        out.width = slot.width;
        return true;
    }

    public getCursor(): { x: number; y: number } | null {
        return this.scrollOffset > 0 ? null : this.cursor; // в скролбэке курсор прячем
    }

    public write(data: string): void {
        this.writes.push(data);
        this.setScrollOffset(0); // как настоящая поверхность: ввод возвращает на дно
    }

    /** Прокрутка вьюпорта: `delta < 0` — вверх, в историю; клампится в [0, scrollbackLines]. */
    public scrollLines(delta: number): void {
        this.setScrollOffset(this.scrollOffset - delta);
    }

    public sendMouse(event: TerminalMouseEventData): void {
        this.mouseEvents.push(event);
    }

    public resize(cols: number, rows: number): void {
        this.resizes.push({ cols, rows });
    }

    public onUpdate(cb: () => void): IDisposable {
        this.updateListeners.add(cb);
        return { dispose: () => this.updateListeners.delete(cb) };
    }

    public onExit(cb: (exitCode: number) => void): IDisposable {
        this.exitListeners.add(cb);
        return { dispose: () => this.exitListeners.delete(cb) };
    }

    /** Помечает фейк убитым (в реале — kill PTY + dispose эмулятора). */
    public dispose(): void {
        this.disposed = true;
    }

    private setScrollOffset(value: number): void {
        const next = Math.max(0, Math.min(value, this.scrollbackLines));
        if (next === this.scrollOffset) return;
        this.scrollOffset = next;
        this.emitUpdate();
    }

    private ensureRow(y: number): FakeSlot[] {
        while (this.grid.length <= y) this.grid.push([]);
        return this.grid[y];
    }
}

function makeCell(char: string): FakeCell {
    return { char, fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, style: 0, width: 1 };
}
