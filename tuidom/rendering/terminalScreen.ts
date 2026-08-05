import type { ITerminalBackend } from "../backend/iTerminalBackend.ts";
import { DEFAULT_COLOR } from "../common/colorUtils.ts";
import { Point, type Rect, Size } from "../common/geometryPromitives.ts";
import { StyleFlags } from "../common/styleFlags.ts";

import type { CellPatch, ReadonlyCellData } from "./grid.ts";
import { Grid } from "./grid.ts";

export class TerminalScreen {
    private grid: Grid;
    public size: Size;
    public cursorPosition: Point | null = null;

    public get width(): number {
        return this.size.width;
    }
    public get height(): number {
        return this.size.height;
    }

    public constructor(size: Size = new Size(80, 24)) {
        this.size = size;
        this.grid = new Grid(size);
    }

    public setCursorPosition(position: Point): void {
        this.cursorPosition = position;
    }

    public clearCursorPosition(): void {
        this.cursorPosition = null;
    }

    public setCell(position: Point, cell: CellPatch): void {
        this.grid.updateCell(position, cell);
    }

    public getCell(position: Point): ReadonlyCellData {
        return this.grid.getCell(position);
    }

    public flush(backend: ITerminalBackend): void {
        backend.renderFrame(this.grid, this.cursorPosition);
    }

    public clear(): void {
        this.grid.fill(" ", DEFAULT_COLOR, DEFAULT_COLOR, StyleFlags.None);
        this.cursorPosition = null;
    }

    /**
     * Семантика {@link clear} в границах rect'а — очистка damage-области перед
     * частичным проходом отрисовки. Курсор НЕ трогает: им управляет кадр
     * (renderFrame гасит позицию, только если она попала в damage).
     */
    public clearRect(rect: Rect): void {
        this.grid.clearRect(rect);
    }

    /** См. {@link Grid.snapToWideChars} — границы области не рассекают wide-пары. */
    public snapToWideChars(rect: Rect): Rect {
        return this.grid.snapToWideChars(rect);
    }
}
