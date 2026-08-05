import { describe, expect, it } from "vitest";

import { DEFAULT_COLOR } from "../common/colorUtils.ts";
import { Point, Rect, Size } from "../common/geometryPromitives.ts";

import { Grid } from "./grid.ts";

// Кромка damage-области не должна рассекать wide-char пару ретейн-грида:
// очистка рассечённой пары лечила бы голову в пробел ВНЕ области перерисовки
// (см. Grid.snapToWideChars и tuiApplication.damage.test.ts).

function rect(x: number, y: number, w: number, h: number): Rect {
    return new Rect(new Point(x, y), new Size(w, h));
}

function gridWithWideAt(x: number, y: number): Grid {
    const grid = new Grid(new Size(10, 3));
    grid.updateCell(new Point(x, y), { char: "你", width: 2, fg: DEFAULT_COLOR, bg: DEFAULT_COLOR });
    return grid;
}

describe("Grid.snapToWideChars", () => {
    it("без пар на кромках возвращает rect как есть", () => {
        const grid = gridWithWideAt(0, 0); // пара в колонках 0-1, кромки её не режут
        expect(grid.snapToWideChars(rect(2, 0, 4, 1))).toEqual(rect(2, 0, 4, 1));
    });

    it("продолжение на левой кромке тянет область до головы", () => {
        const grid = gridWithWideAt(2, 0); // голова 2, продолжение 3
        expect(grid.snapToWideChars(rect(3, 0, 4, 1))).toEqual(rect(2, 0, 5, 1));
    });

    it("голова на правой кромке тянет область до продолжения", () => {
        const grid = gridWithWideAt(4, 0); // голова 4, продолжение 5
        expect(grid.snapToWideChars(rect(2, 0, 3, 1))).toEqual(rect(2, 0, 4, 1));
    });

    it("обе кромки сразу: расширение в обе стороны", () => {
        const grid = new Grid(new Size(10, 3));
        grid.updateCell(new Point(1, 0), { char: "你", width: 2 }); // 1-2
        grid.updateCell(new Point(5, 0), { char: "好", width: 2 }); // 5-6
        expect(grid.snapToWideChars(rect(2, 0, 4, 1))).toEqual(rect(1, 0, 6, 1));
    });
});
