import type { ITerminalBackend } from "../backend/iTerminalBackend.ts";
import { DEFAULT_COLOR } from "../common/colorUtils.ts";
import { Point, Size } from "../common/geometryPromitives.ts";
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
}
