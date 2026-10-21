import { describe, expect, it } from "vitest";

import { DefaultLinesDiffComputer } from "./defaultLinesDiffComputer/defaultLinesDiffComputer.ts";
import type { IDiffViewOptions, IDiffViewRow } from "./diffViewModel.ts";
import { DEFAULT_DIFF_VIEW_OPTIONS, DiffViewModel } from "./diffViewModel.ts";

/** Вход — тексты и настоящий движок, а не выдуманные `LineRange`: перекат пина краснеет здесь. */

const COMPUTER = new DefaultLinesDiffComputer();

function model(original: string[], modified: string[], options: Partial<IDiffViewOptions> = {}): DiffViewModel {
    const diff = COMPUTER.computeDiff(original, modified, {
        ignoreTrimWhitespace: false,
        maxComputationTimeMs: Number.MAX_SAFE_INTEGER,
        computeMoves: false,
    });
    return new DiffViewModel(diff.changes, original.length, modified.length, options);
}

/** Компактная запись строк вью: `=o/m`, `-o`, `+m`, `[⋯N#i]`. */
function sketch(rows: readonly IDiffViewRow[]): string {
    return rows
        .map((row) => {
            switch (row.kind) {
                case "unchanged":
                    return `=${String(row.originalLine)}/${String(row.modifiedLine)}`;
                case "deleted":
                    return `-${String(row.originalLine)}`;
                case "added":
                    return `+${String(row.modifiedLine)}`;
                default:
                    return `[⋯${String(row.hiddenLineCount)}#${String(row.regionIndex)}]`;
            }
        })
        .join(" ");
}

function shape(rows: readonly IDiffViewRow[]): string {
    return rows
        .map((row) =>
            row.kind === "unchanged" ? "=" : row.kind === "deleted" ? "-" : row.kind === "added" ? "+" : "⋯",
        )
        .join("");
}

const lines = (count: number): string[] => Array.from({ length: count }, (_, i) => `line${String(i)}`);

const COLLAPSED: Partial<IDiffViewOptions> = { hideUnchangedRegions: true };

describe("DiffViewModel — полнофайловый режим (дефолт)", () => {
    it("по умолчанию ничего не прячет — как diffEditor.hideUnchangedRegions в upstream", () => {
        expect(DEFAULT_DIFF_VIEW_OPTIONS.hideUnchangedRegions).toBe(false);
        expect(model(lines(40), lines(40)).regions).toEqual([]);
    });

    it("одинаковые тексты дают ровно по строке на строку файла", () => {
        const rows = model(lines(4), lines(4)).rows;

        expect(sketch(rows)).toBe("=0/0 =1/1 =2/2 =3/3");
    });

    it("вставка даёт added, не сдвигая номера соседей", () => {
        expect(sketch(model(["a", "c"], ["a", "b", "c"]).rows)).toBe("=0/0 +1 =1/2");
    });

    it("удаление даёт deleted", () => {
        expect(sketch(model(["a", "b", "c"], ["a", "c"]).rows)).toBe("=0/0 -1 =2/1");
    });

    it("правка идёт как удалённая строка, затем добавленная", () => {
        expect(sketch(model(["a", "b", "c"], ["a", "B", "c"]).rows)).toBe("=0/0 -1 +1 =2/2");
    });

    it("многострочная правка выдаёт сначала все удалённые, потом все добавленные", () => {
        expect(shape(model(["a", "b", "c", "d"], ["a", "B", "C", "d"]).rows)).toBe("=--++=");
    });

    it("пустой оригинал — только добавленные строки", () => {
        expect(shape(model([""], ["x", "y"]).rows)).toBe("-++");
    });

    it("пустой изменённый — только удалённые", () => {
        expect(shape(model(["x", "y"], [""]).rows)).toBe("--+");
    });
});

describe("DiffViewModel — свёртка неизменённых кусков", () => {
    it("одинаковые файлы схлопываются целиком в один плейсхолдер", () => {
        const m = model(lines(20), lines(20), COLLAPSED);

        expect(sketch(m.rows)).toBe("[⋯20#0]");
        expect(m.regions).toHaveLength(1);
        expect(m.regions[0]).toMatchObject({ originalStartLine: 0, lineCount: 20, hiddenLineCount: 20 });
    });

    it("вокруг изменения в середине остаётся контекст с обеих сторон", () => {
        const original = lines(20);
        const modified = [...lines(20).slice(0, 9), "X", ...lines(20).slice(10)];

        expect(sketch(model(original, modified, COLLAPSED).rows)).toBe(
            "[⋯6#0] =6/6 =7/7 =8/8 -9 +9 =10/10 =11/11 =12/12 [⋯7#1]",
        );
    });

    it("у края файла контекст срезается только с внутренней стороны", () => {
        const atStart = model(lines(20), ["X", ...lines(20).slice(1)], COLLAPSED);
        const atEnd = model(lines(20), [...lines(20).slice(0, 19), "X"], COLLAPSED);

        expect(sketch(atStart.rows)).toBe("-0 +0 =1/1 =2/2 =3/3 [⋯16#0]");
        expect(sketch(atEnd.rows)).toBe("[⋯16#0] =16/16 =17/17 =18/18 -19 +19");
    });

    it("короткий промежуток между изменениями не сворачивается", () => {
        expect(shape(model(["a", "b", "c", "d", "e"], ["A", "b", "c", "d", "E"], COLLAPSED).rows)).toBe("-+===-+");
    });

    it("промежуток ровно на границе минимума сворачивается, на строку короче — нет", () => {
        // Середина: нужно contextLineCount * 2 + minimumHiddenLineCount = 9.
        const gap = (n: number) => {
            const middle = lines(n).map((l) => `mid-${l}`);
            return model(["a", ...middle, "z"], ["A", ...middle, "Z"], COLLAPSED);
        };

        expect(shape(gap(9).rows)).toBe("-+===⋯===-+");
        expect(shape(gap(8).rows)).toBe("-+========-+");
    });

    it("regionIndex в плейсхолдере указывает на существующий регион", () => {
        const original = lines(30);
        const modified = [...lines(30).slice(0, 14), "X", ...lines(30).slice(15)];
        const m = model(original, modified, COLLAPSED);

        const placeholders = m.rows.filter((r) => r.kind === "collapsed");
        expect(placeholders).toHaveLength(2);
        for (const row of placeholders) {
            expect(m.regions[row.regionIndex]).toBeDefined();
            expect(m.regions[row.regionIndex].hiddenLineCount).toBe(row.hiddenLineCount);
        }
    });

    it("видимые и скрытые строки в сумме покрывают файл", () => {
        const original = lines(30);
        const modified = [...lines(30).slice(0, 14), "X", ...lines(30).slice(15)];
        const m = model(original, modified, COLLAPSED);

        const visible = m.rows.filter((r) => r.kind === "unchanged" || r.kind === "added").length;
        const hidden = m.rows.reduce((sum, r) => sum + (r.kind === "collapsed" ? r.hiddenLineCount : 0), 0);
        expect(visible + hidden).toBe(modified.length);
    });

    it("настройки контекста и минимума уважаются", () => {
        const original = lines(20);
        const modified = [...lines(20).slice(0, 9), "X", ...lines(20).slice(10)];
        const m = model(original, modified, { hideUnchangedRegions: true, contextLineCount: 1 });

        expect(sketch(m.rows)).toBe("[⋯8#0] =8/8 -9 +9 =10/10 [⋯9#1]");
    });

    it("огромный минимум скрываемого отключает свёртку", () => {
        const m = model(lines(20), lines(20), { hideUnchangedRegions: true, minimumHiddenLineCount: 1000 });

        expect(m.regions).toEqual([]);
        expect(shape(m.rows)).toBe("=".repeat(20));
    });
});

describe("DiffViewModel — раскрытие", () => {
    const original = lines(30);
    const modified = [...lines(30).slice(0, 9), "X", ...lines(30).slice(10)];
    const build = () => model(original, modified, COLLAPSED);

    it("раскрытие целиком убирает плейсхолдер", () => {
        const m = build();
        m.expandRegion(0);

        expect(m.regions[0].hiddenLineCount).toBe(0);
        expect(m.rows.some((r) => r.kind === "collapsed" && r.regionIndex === 0)).toBe(false);
    });

    it("частичное раскрытие сверху открывает строки перед плейсхолдером", () => {
        const m = build();
        const before = shape(m.rows);
        m.expandRegion(1, "top", 4);

        expect(m.regions[1].hiddenLineCount).toBe(13);
        expect(m.regions[1].visibleTop).toBe(4);
        expect(shape(m.rows)).toBe(before.replace("+===⋯", "+=======⋯"));
    });

    it("частичное раскрытие снизу открывает строки после плейсхолдера", () => {
        const m = build();
        m.expandRegion(1, "bottom", 4);

        expect(m.regions[1].visibleBottom).toBe(4);
        expect(shape(m.rows).endsWith("⋯====")).toBe(true);
    });

    it("раскрытие сверх размера куска клампится, а не уезжает в минус", () => {
        const m = build();
        m.expandRegion(1, "top", 999);

        expect(m.regions[1].hiddenLineCount).toBe(0);
        expect(m.regions[1].visibleTop).toBe(17);
        expect(m.rows.some((r) => r.kind === "collapsed" && r.regionIndex === 1)).toBe(false);
    });

    it("раскрытия с двух краёв не пересекаются", () => {
        const m = build();
        m.expandRegion(1, "top", 999);
        m.expandRegion(1, "bottom", 999);

        expect(m.regions[1].visibleTop + m.regions[1].visibleBottom).toBe(m.regions[1].lineCount);
        expect(m.regions[1].hiddenLineCount).toBe(0);
    });

    it("шаг по умолчанию — revealLineCount", () => {
        const m = model(original, modified, { hideUnchangedRegions: true, revealLineCount: 5 });
        m.expandRegion(1, "top");

        expect(m.regions[1].visibleTop).toBe(5);
    });

    it("expandAll разворачивает все куски", () => {
        const m = build();
        m.expandAll();

        expect(m.regions.every((r) => r.hiddenLineCount === 0)).toBe(true);
        expect(m.rows.some((r) => r.kind === "collapsed")).toBe(false);
        expect(m.rows).toHaveLength(modified.length + 1); // +1 — удалённая строка правки
    });

    it("неизвестный индекс — no-op, включая отрицательный", () => {
        // `at(-1)` вернул бы последний элемент — expandRegion(-1) раскрыл бы чужой кусок.
        const m = build();
        const before = sketch(m.rows);

        m.expandRegion(99);
        m.expandRegion(-1);

        expect(sketch(m.rows)).toBe(before);
    });

    it("нулевой шаг ничего не меняет", () => {
        const m = build();
        const before = sketch(m.rows);
        m.expandRegion(1, "top", 0);

        expect(sketch(m.rows)).toBe(before);
    });

    it("отрицательный шаг не сворачивает уже раскрытое", () => {
        const m = build();
        m.expandRegion(1, "top", 4);
        m.expandRegion(1, "top", -10);

        expect(m.regions[1].visibleTop).toBe(4);
    });

    it("в полнофайловом режиме раскрывать нечего", () => {
        const m = model(original, modified);
        const before = sketch(m.rows);

        m.expandAll();

        expect(m.regions).toEqual([]);
        expect(sketch(m.rows)).toBe(before);
    });
});
