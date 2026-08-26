import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_COLOR } from "@tuidom/core/common/colorUtils";
import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { SPINNER_FRAMES } from "../../src/vs/platform/progress/common/progressService.ts";
import { BUNDLED_FONT_FILES, renderSnapshotToPng } from "./renderScreenshot.ts";

// Гейт на «тофу»: строковые ассерты в юнитах видят кадр спиннера как символ, а
// на картинке он может выйти пустым квадратом — ровно это и случилось в #272,
// когда единственным завендоренным шрифтом был Hack (блока U+2800 у него нет).

/** Кодпоинты, покрытые шрифтом: минимальный разбор `cmap` (форматы 4 и 12). */
function fontCodePoints(path: string): Set<number> {
    const buf = readFileSync(path);
    const numTables = buf.readUInt16BE(4);
    let cmap = -1;
    for (let i = 0; i < numTables; i++) {
        const record = 12 + i * 16;
        if (buf.toString("ascii", record, record + 4) === "cmap") cmap = buf.readUInt32BE(record + 8);
    }
    if (cmap < 0) throw new Error(`${basename(path)}: нет таблицы cmap`);

    const covered = new Set<number>();
    const subtables = buf.readUInt16BE(cmap + 2);
    for (let i = 0; i < subtables; i++) {
        const sub = cmap + buf.readUInt32BE(cmap + 4 + i * 8 + 4);
        const format = buf.readUInt16BE(sub);
        if (format === 4) {
            const segX2 = buf.readUInt16BE(sub + 6);
            const ends = sub + 14;
            const starts = ends + segX2 + 2;
            for (let seg = 0; seg < segX2 / 2; seg++) {
                const end = buf.readUInt16BE(ends + seg * 2);
                const start = buf.readUInt16BE(starts + seg * 2);
                // Замыкающий сегмент 0xFFFF–0xFFFF обязателен по спеке и пуст.
                if (start === 0xffff) continue;
                for (let cp = start; cp <= end; cp++) covered.add(cp);
            }
        } else if (format === 12) {
            const groups = buf.readUInt32BE(sub + 12);
            for (let g = 0; g < groups; g++) {
                const record = sub + 16 + g * 12;
                const end = buf.readUInt32BE(record + 4);
                for (let cp = buf.readUInt32BE(record); cp <= end; cp++) covered.add(cp);
            }
        }
    }
    return covered;
}

/** Строка в один ряд: цвета дефолтные, ширина ячейки 1 — как отдаёт настоящий грид. */
function snapshotOf(text: string): GridSnapshot {
    return {
        cols: [...text].length,
        rows: 1,
        cursor: null,
        cells: [...text].map((char) => ({ char, fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, style: 0, width: 1 })),
    };
}

describe("растеризатор скриншотов", () => {
    it("завендоренные шрифты покрывают все кадры спиннера", () => {
        const covered = BUNDLED_FONT_FILES.map(fontCodePoints);
        const missing = SPINNER_FRAMES.filter((frame) => !covered.some((set) => set.has(frame.codePointAt(0)!)));
        expect(missing).toEqual([]);
    });

    it("разные кадры спиннера рисуются разными глифами", () => {
        // Если покрывающего шрифта в наборе нет, resvg рисует всем непокрытым
        // кодпоинтам один и тот же `.notdef` — байты PNG совпадут. Отличие от
        // пробела ловит обратный случай: шрифт есть, но глиф пустой.
        const [first, second] = SPINNER_FRAMES;
        const blank = renderSnapshotToPng(snapshotOf(" "));

        expect(renderSnapshotToPng(snapshotOf(first))).not.toEqual(renderSnapshotToPng(snapshotOf(second)));
        expect(renderSnapshotToPng(snapshotOf(first))).not.toEqual(blank);
    });
});
