import { describe, expect, it } from "vitest";

import { DefaultLinesDiffComputer } from "./defaultLinesDiffComputer/defaultLinesDiffComputer.ts";
import type { IDiffViewRow } from "./diffViewModel.ts";
import { DiffViewModel } from "./diffViewModel.ts";
import type { DiffSide } from "./diffViewText.ts";
import { collapsedRowLabel } from "./diffViewText.ts";
import type { ISideBySideRow } from "./sideBySideRows.ts";
import {
    buildSideBySideRows,
    buildSideBySideText,
    createSideBySideViewStates,
    inlineLineOf,
    sideBySideLineOf,
    sideLineOf,
} from "./sideBySideRows.ts";

/**
 * Как и в diffViewModel.test.ts, вход задаём парой текстов и настоящим движком:
 * тест проверяет связку «дифф → inline-строки → спаривание» целиком.
 */

const COMPUTER = new DefaultLinesDiffComputer();

function inlineRows(original: string[], modified: string[], collapsed = false): readonly IDiffViewRow[] {
    const diff = COMPUTER.computeDiff(original, modified, {
        ignoreTrimWhitespace: false,
        maxComputationTimeMs: Number.MAX_SAFE_INTEGER,
        computeMoves: false,
    });
    return new DiffViewModel(diff.changes, original.length, modified.length, {
        hideUnchangedRegions: collapsed,
    }).rows;
}

/** Компактная запись спаренных строк: `=o/m`, `o|m` (`·` — филлер), `[⋯N#i]`. */
function sketch(rows: readonly ISideBySideRow[]): string {
    return rows
        .map((row) => {
            switch (row.kind) {
                case "unchanged":
                    return `=${String(row.originalLine)}/${String(row.modifiedLine)}`;
                case "changed":
                    return `${row.originalLine === null ? "·" : String(row.originalLine)}|${
                        row.modifiedLine === null ? "·" : String(row.modifiedLine)
                    }`;
                default:
                    return `[⋯${String(row.hiddenLineCount)}#${String(row.regionIndex)}]`;
            }
        })
        .join(" ");
}

/** N строк с уникальным содержимым. */
const lines = (count: number): string[] => Array.from({ length: count }, (_, i) => `line${String(i)}`);

/** Номера строк стороны в порядке следования (без филлеров и плашек). */
function sideLines(rows: readonly ISideBySideRow[], side: DiffSide): number[] {
    return rows.map((row) => sideLineOf(row, side)).filter((line): line is number => line !== null);
}

function inlineSideLines(rows: readonly IDiffViewRow[], side: DiffSide): number[] {
    const result: number[] = [];
    for (const row of rows) {
        if (row.kind === "collapsed") continue;
        if (side === "original" && row.kind !== "added") result.push(row.originalLine);
        if (side === "modified" && row.kind !== "deleted") result.push(row.modifiedLine);
    }
    return result;
}

describe("buildSideBySideRows — спаривание", () => {
    it("правка строки спаривается в одну строку вью", () => {
        const rows = buildSideBySideRows(inlineRows(["a", "b", "c"], ["a", "B", "c"]));

        expect(sketch(rows)).toBe("=0/0 1|1 =2/2");
    });

    it("чистая вставка даёт филлер слева", () => {
        expect(sketch(buildSideBySideRows(inlineRows(["a", "c"], ["a", "b", "c"])))).toBe("=0/0 ·|1 =1/2");
    });

    it("чистое удаление даёт филлер справа", () => {
        expect(sketch(buildSideBySideRows(inlineRows(["a", "b", "c"], ["a", "c"])))).toBe("=0/0 1|· =2/1");
    });

    it("блок D>A: хвост удалённых напротив филлеров", () => {
        // 3 удалённых, 1 добавленная: пары (1,1), (2,·), (3,·).
        const rows = buildSideBySideRows(inlineRows(["a", "x", "y", "z", "b"], ["a", "X", "b"]));

        expect(sketch(rows)).toBe("=0/0 1|1 2|· 3|· =4/2");
    });

    it("блок A>D: хвост добавленных напротив филлеров", () => {
        const rows = buildSideBySideRows(inlineRows(["a", "x", "b"], ["a", "X", "Y", "Z", "b"]));

        expect(sketch(rows)).toBe("=0/0 1|1 ·|2 ·|3 =2/4");
    });

    it("два изменения разделяются неизменённой строкой", () => {
        const rows = buildSideBySideRows(inlineRows(["a", "x", "b", "y", "c"], ["a", "X", "b", "Y", "c"]));

        expect(sketch(rows)).toBe("=0/0 1|1 =2/2 3|3 =4/4");
    });

    it("удаление сразу после добавления начинает новую пару", () => {
        // Синтетический вход: два блока изменений подряд без промежутка. Движок
        // такое склеивает в один change, но спариватель не должен зависеть от
        // этой вежливости.
        const rows: IDiffViewRow[] = [
            { kind: "added", modifiedLine: 0 },
            { kind: "deleted", originalLine: 0 },
            { kind: "added", modifiedLine: 1 },
        ];

        expect(sketch(buildSideBySideRows(rows))).toBe("·|0 0|1");
    });

    it("плашка свёрнутого куска проходит как одна строка на обе колонки", () => {
        const original = [...lines(20), "x", ...lines(20).map((l) => `${l}t`)];
        const modified = [...lines(20), "X", ...lines(20).map((l) => `${l}t`)];
        const rows = inlineRows(original, modified, true);
        const paired = buildSideBySideRows(rows);

        const collapsed = paired.filter((row) => row.kind === "collapsed");
        expect(collapsed.length).toBeGreaterThan(0);
        expect(collapsed).toEqual(rows.filter((row) => row.kind === "collapsed"));
    });

    it("инвариант: номера строк каждой стороны сохраняются и строго растут", () => {
        const original = [...lines(6), "x", "y", ...lines(4).map((l) => `${l}b`), "q"];
        const modified = [...lines(6), "X", ...lines(4).map((l) => `${l}b`), "Q", "R"];
        const rows = inlineRows(original, modified);
        const paired = buildSideBySideRows(rows);

        for (const side of ["original", "modified"] as const) {
            const got = sideLines(paired, side);
            expect(got).toEqual(inlineSideLines(rows, side));
            expect(got).toEqual([...got].sort((a, b) => a - b));
        }
    });

    it("инвариант: changed не бывает с двумя филлерами, экономия строк = Σ min(D,A)", () => {
        const rows = inlineRows(["a", "x", "y", "b", "p", "c"], ["a", "X", "b", "P", "Q", "c"]);
        const paired = buildSideBySideRows(rows);

        for (const row of paired) {
            if (row.kind === "changed") {
                expect(row.originalLine !== null || row.modifiedLine !== null).toBe(true);
            }
        }
        // Блок x,y→X даёт min(2,1)=1; блок p→P,Q даёт min(1,2)=1.
        expect(rows.length - paired.length).toBe(2);
    });
});

describe("buildSideBySideText и createSideBySideViewStates", () => {
    const original = ["alpha", "beta", "gamma"];
    const modified = ["alpha", "BETA", "extra", "gamma"];

    it("текст стороны: свои строки, пустые филлеры, общий плейсхолдер плашки", () => {
        const paired = buildSideBySideRows(inlineRows(original, modified));

        expect(buildSideBySideText(paired, "original", { original, modified })).toBe("alpha\nbeta\n\ngamma");
        expect(buildSideBySideText(paired, "modified", { original, modified })).toBe("alpha\nBETA\nextra\ngamma");
    });

    it("у плашки обе стороны показывают её плейсхолдер", () => {
        const long = lines(30);
        const changed = [...lines(30)];
        changed[29] = "CHANGED";
        const paired = buildSideBySideRows(inlineRows(long, changed, true));
        const collapsed = paired.find((row) => row.kind === "collapsed");
        expect(collapsed).toBeDefined();
        const index = paired.indexOf(collapsed ?? paired[0]);
        const label = collapsedRowLabel(collapsed?.kind === "collapsed" ? collapsed.hiddenLineCount : 0);

        for (const side of ["original", "modified"] as const) {
            const text = buildSideBySideText(paired, side, { original: long, modified: changed });
            expect(text.split("\n")[index]).toBe(label);
        }
    });

    it("viewState'ы сторон: read-only, одинаковая длина, tabSize задан", () => {
        const paired = buildSideBySideRows(inlineRows(original, modified));
        const states = createSideBySideViewStates(paired, { original, modified }, 4);

        expect(states.original.readOnly).toBe(true);
        expect(states.modified.readOnly).toBe(true);
        expect(states.original.getViewLineCount()).toBe(paired.length);
        expect(states.modified.getViewLineCount()).toBe(paired.length);
        expect(states.original.tabSize).toBe(4);
    });
});

describe("маппинг строк для смены режима", () => {
    const original = ["a", "x", "y", "b", "c"];
    const modified = ["a", "X", "b", "c", "d"];

    it("sideBySideLineOf находит видимые строки обеих сторон", () => {
        const paired = buildSideBySideRows(inlineRows(original, modified));
        // "=0/0 1|1 2|· =3/2 =4/3 ·|4"

        expect(sideBySideLineOf(paired, "original", 0)).toBe(0);
        expect(sideBySideLineOf(paired, "original", 2)).toBe(2);
        expect(sideBySideLineOf(paired, "modified", 1)).toBe(1);
        expect(sideBySideLineOf(paired, "modified", 4)).toBe(5);
    });

    it("inlineLineOf находит видимые строки обеих сторон", () => {
        const rows = inlineRows(original, modified);
        // "=0/0 -1 -2 +1 =3/2 =4/3 +4"

        expect(inlineLineOf(rows, "original", 1)).toBe(1);
        expect(inlineLineOf(rows, "original", 2)).toBe(2);
        expect(inlineLineOf(rows, "modified", 1)).toBe(3);
        expect(inlineLineOf(rows, "modified", 4)).toBe(6);
    });

    it("round-trip: видимая строка возвращается на себя через (side, fileLine)", () => {
        const rows = inlineRows(original, modified);
        const paired = buildSideBySideRows(rows);

        const inlineLineAt = (row: IDiffViewRow, side: DiffSide): number => {
            if (row.kind === "collapsed") return -1;
            if (side === "original") return row.kind === "added" ? -1 : row.originalLine;
            return row.kind === "deleted" ? -1 : row.modifiedLine;
        };
        for (const side of ["original", "modified"] as const) {
            for (const fileLine of inlineSideLines(rows, side)) {
                const sideLine = sideBySideLineOf(paired, side, fileLine);
                expect(sideLineOf(paired[sideLine], side)).toBe(fileLine);
                expect(inlineLineAt(rows[inlineLineOf(rows, side, fileLine)], side)).toBe(fileLine);
            }
        }
    });

    it("скрытая в плашке строка даёт индекс плашки", () => {
        const long = lines(40);
        const changed = [...lines(40)];
        changed[0] = "FIRST";
        changed[39] = "LAST";
        const rows = inlineRows(long, changed, true);
        const paired = buildSideBySideRows(rows);
        const collapsedIndex = paired.findIndex((row) => row.kind === "collapsed");
        expect(collapsedIndex).toBeGreaterThan(0);

        expect(sideBySideLineOf(paired, "original", 20)).toBe(collapsedIndex);
        expect(inlineLineOf(rows, "modified", 20)).toBe(rows.findIndex((row) => row.kind === "collapsed"));
    });

    it("строка за концом даёт последнюю строку вью", () => {
        const paired = buildSideBySideRows(inlineRows(original, modified));

        expect(sideBySideLineOf(paired, "original", 99)).toBe(paired.length - 1);
    });

    it("строка за концом при хвостовой плашке даёт плашку", () => {
        // Изменение в начале файла, хвост свёрнут — плашка последняя.
        const long = lines(30);
        const changed = [...lines(30)];
        changed[0] = "FIRST";
        const paired = buildSideBySideRows(inlineRows(long, changed, true));
        expect(paired.at(-1)?.kind).toBe("collapsed");

        expect(sideBySideLineOf(paired, "modified", 99)).toBe(paired.length - 1);
    });

    it("разрыв номеров без плашки даёт первую строку после разрыва", () => {
        // Синтетика: так строки не строит ни одна модель, но скан не должен
        // зависеть от вежливости поставщика.
        const rows: ISideBySideRow[] = [
            { kind: "unchanged", originalLine: 0, modifiedLine: 0 },
            { kind: "unchanged", originalLine: 5, modifiedLine: 5 },
        ];

        expect(sideBySideLineOf(rows, "original", 3)).toBe(1);
    });

    it("текст стороны за пределами массива строк — пустая строка", () => {
        const rows: ISideBySideRow[] = [{ kind: "unchanged", originalLine: 7, modifiedLine: 7 }];

        expect(buildSideBySideText(rows, "original", { original: ["only"], modified: ["only"] })).toBe("");
    });
});
