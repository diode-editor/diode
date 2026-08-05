import { DEFAULT_COLOR } from "../common/colorUtils.ts";
import { Point, Rect, Size } from "../common/geometryPromitives.ts";
import { StyleFlags } from "../common/styleFlags.ts";

import { Cell } from "./cell.ts";

export interface ReadonlyCellData {
    readonly char: string;
    readonly fg: number;
    readonly bg: number;
    readonly style: number;
    readonly width: number;
}

export interface CellPatch {
    char?: string;
    fg?: number;
    bg?: number;
    style?: number;
    width?: number;
}

/**
 * 2D grid of terminal cells backed by a flat array for cache-friendly access.
 */
export class Grid {
    public readonly size: Size;
    private readonly cells: Cell[];

    public get width(): number {
        return this.size.width;
    }
    public get height(): number {
        return this.size.height;
    }
    public get cellCount(): number {
        return this.cells.length;
    }

    public constructor(size: Size) {
        this.size = size;
        const total = size.width * size.height;
        this.cells = new Array<Cell>(total);
        for (let i = 0; i < total; i++) {
            this.cells[i] = Cell.empty();
        }
    }

    public getCell(position: Point): ReadonlyCellData {
        return this.cells[position.y * this.size.width + position.x];
    }

    public getCellAt(x: number, y: number): ReadonlyCellData {
        return this.cells[y * this.size.width + x];
    }

    public setCell(
        position: Point,
        char: string,
        fg: number = DEFAULT_COLOR,
        bg: number = DEFAULT_COLOR,
        style: number = StyleFlags.None,
        width = 1,
    ): void {
        const x = position.x;
        const y = position.y;
        const idx = y * this.size.width + x;
        const cell = this.cells[idx];

        // If overwriting a continuation cell, clear the head cell of that wide char
        if (cell.width === 0 && x > 0) {
            const head = this.cells[idx - 1];
            if (head.width === 2) {
                head.char = " ";
                head.width = 1;
            }
        }
        // If overwriting a head cell of a wide char, clear its continuation
        if (cell.width === 2 && x + 1 < this.size.width) {
            const cont = this.cells[idx + 1];
            /* v8 ignore start -- a wide head is always followed by a width-0 continuation; the else is an unreachable invariant guard */
            if (cont.width === 0) {
                cont.char = " ";
                cont.width = 1;
            }
            /* v8 ignore stop */
        }

        cell.char = char;
        cell.fg = fg;
        cell.bg = bg;
        cell.style = style;
        cell.width = width;

        // For wide chars, set up the continuation cell
        if (width === 2 && x + 1 < this.size.width) {
            const cont = this.cells[idx + 1];
            // If the continuation position holds a wide char head, clear its own continuation
            if (cont.width === 2 && x + 2 < this.size.width) {
                const nextCont = this.cells[idx + 2];
                /* v8 ignore start -- a wide head is always followed by a width-0 continuation; the else is an unreachable invariant guard */
                if (nextCont.width === 0) {
                    nextCont.char = " ";
                    nextCont.width = 1;
                }
                /* v8 ignore stop */
            }
            cont.char = "";
            cont.fg = fg;
            cont.bg = bg;
            cont.style = style;
            cont.width = 0;
        }
    }

    public updateCell(position: Point, patch: CellPatch): void {
        const x = position.x;
        const y = position.y;
        const w = this.size.width;
        const idx = y * w + x;
        const cell = this.cells[idx];

        // Wide-char bookkeeping only when char or width are being set
        if (patch.char !== undefined || patch.width !== undefined) {
            // If overwriting a continuation cell, clear the head cell of that wide char
            if (cell.width === 0 && x > 0) {
                const head = this.cells[idx - 1];
                if (head.width === 2) {
                    head.char = " ";
                    head.width = 1;
                }
            }
            // If overwriting a head cell of a wide char, clear its continuation
            if (cell.width === 2 && x + 1 < w) {
                const cont = this.cells[idx + 1];
                /* v8 ignore start -- a wide head is always followed by a width-0 continuation; the else is an unreachable invariant guard */
                if (cont.width === 0) {
                    cont.char = " ";
                    cont.width = 1;
                }
                /* v8 ignore stop */
            }
        }

        if (patch.char !== undefined) cell.char = patch.char;
        if (patch.fg !== undefined) cell.fg = patch.fg;
        if (patch.bg !== undefined) cell.bg = patch.bg;
        if (patch.style !== undefined) cell.style = patch.style;
        if (patch.width !== undefined) cell.width = patch.width;

        // For wide chars, set up the continuation cell
        const newWidth = patch.width ?? cell.width;
        if (newWidth === 2 && x + 1 < w) {
            const cont = this.cells[idx + 1];
            // If the continuation position holds a wide char head, clear its own continuation
            if (cont.width === 2 && x + 2 < w) {
                const nextCont = this.cells[idx + 2];
                /* v8 ignore start -- a wide head is always followed by a width-0 continuation; the else is an unreachable invariant guard */
                if (nextCont.width === 0) {
                    nextCont.char = " ";
                    nextCont.width = 1;
                }
                /* v8 ignore stop */
            }
            cont.char = "";
            cont.width = 0;
            if (patch.fg !== undefined) cont.fg = patch.fg;
            if (patch.bg !== undefined) cont.bg = patch.bg;
            if (patch.style !== undefined) cont.style = patch.style;
        }
    }

    public cellEqualsAt(x: number, y: number, other: Grid): boolean {
        const idx = y * this.size.width + x;
        return this.cells[idx].equals(other.cells[idx]);
    }

    public copyCellFrom(x: number, y: number, source: Grid): void {
        const idx = y * this.size.width + x;
        this.cells[idx].copyFrom(source.cells[idx]);
    }

    public copyAllCellsFrom(source: Grid): void {
        for (let i = 0, len = this.cells.length; i < len; i++) {
            this.cells[i].copyFrom(source.cells[i]);
        }
    }

    /**
     * Расширяет rect так, чтобы его вертикальные границы не рассекали wide-char
     * пары ТЕКУЩЕГО содержимого: продолжение (width 0) на левой кромке тянет
     * внутрь голову слева, голова (width 2) на правой — продолжение справа.
     * Иначе частичная очистка damage-области лечила бы голову в пробел ВНЕ
     * области перерисовки — видимая порча соседнего чистого виджета. Одного
     * прохода достаточно: за расширенной кромкой пара уже целиком внутри.
     */
    public snapToWideChars(rect: Rect): Rect {
        const w = this.size.width;
        const x0 = Math.max(0, rect.x);
        const y0 = Math.max(0, rect.y);
        const x1 = Math.min(w, rect.right);
        const y1 = Math.min(this.size.height, rect.bottom);
        let extendLeft = false;
        let extendRight = false;
        for (let y = y0; y < y1; y++) {
            if (x0 > 0 && this.cells[y * w + x0].width === 0) extendLeft = true;
            if (x1 < w && x1 > 0 && this.cells[y * w + x1 - 1].width === 2) extendRight = true;
        }
        if (!extendLeft && !extendRight) return rect;
        const newX0 = extendLeft ? x0 - 1 : x0;
        const newX1 = extendRight ? x1 + 1 : x1;
        return new Rect(new Point(newX0, rect.y), new Size(newX1 - newX0, rect.height));
    }

    /**
     * Сбрасывает ячейки rect'а к значениям clear() — через {@link updateCell},
     * чтобы wide-char пара, пересекающая границу rect'а, чинилась штатной
     * бухгалтерией головы/продолжения, а не оставляла осиротевшие половинки.
     */
    public clearRect(rect: Rect): void {
        const x0 = Math.max(0, rect.x);
        const y0 = Math.max(0, rect.y);
        const x1 = Math.min(this.size.width, rect.right);
        const y1 = Math.min(this.size.height, rect.bottom);
        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
                this.updateCell(new Point(x, y), {
                    char: " ",
                    fg: DEFAULT_COLOR,
                    bg: DEFAULT_COLOR,
                    style: StyleFlags.None,
                    width: 1,
                });
            }
        }
    }

    public fill(
        char = " ",
        fg: number = DEFAULT_COLOR,
        bg: number = DEFAULT_COLOR,
        style: number = StyleFlags.None,
    ): void {
        for (let i = 0, len = this.cells.length; i < len; i++) {
            const cell = this.cells[i];
            cell.char = char;
            cell.fg = fg;
            cell.bg = bg;
            cell.style = style;
            cell.width = 1;
        }
    }
}
