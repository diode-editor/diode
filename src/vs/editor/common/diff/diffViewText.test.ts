import { describe, expect, it } from "vitest";

import type { IDiffViewRow } from "./diffViewModel.ts";
import { buildDiffViewText, collapsedRowLabel, createDiffViewState, rowLine, rowSide } from "./diffViewText.ts";

const SIDES = {
    original: ["o0", "o1", "o2"],
    modified: ["m0", "m1", "m2"],
};

const unchanged = (o: number, m: number): IDiffViewRow => ({ kind: "unchanged", originalLine: o, modifiedLine: m });
const deleted = (o: number): IDiffViewRow => ({ kind: "deleted", originalLine: o });
const added = (m: number): IDiffViewRow => ({ kind: "added", modifiedLine: m });
const collapsed = (hidden: number): IDiffViewRow => ({ kind: "collapsed", hiddenLineCount: hidden, regionIndex: 0 });

describe("diffViewText — сторона и номер строки", () => {
    it("удалённая строка берётся из оригинала, остальные — из изменённого", () => {
        expect(rowSide(deleted(1))).toBe("original");
        expect(rowSide(added(1))).toBe("modified");
        expect(rowSide(unchanged(1, 2))).toBe("modified");
    });

    it("у плейсхолдера стороны и номера нет", () => {
        expect(rowSide(collapsed(5))).toBeNull();
        expect(rowLine(collapsed(5))).toBe(-1);
    });

    it("номер берётся со своей стороны", () => {
        expect(rowLine(deleted(1))).toBe(1);
        expect(rowLine(unchanged(1, 2))).toBe(2);
    });
});

describe("diffViewText — плейсхолдер", () => {
    it("единственная скрытая строка склоняется в единственном числе", () => {
        expect(collapsedRowLabel(1)).toBe("⋯ 1 unchanged line");
    });

    it("несколько скрытых строк — во множественном", () => {
        expect(collapsedRowLabel(12)).toBe("⋯ 12 unchanged lines");
    });
});

describe("diffViewText — текст вью", () => {
    it("каждый вид строки берёт текст со своей стороны", () => {
        const rows = [unchanged(0, 0), deleted(1), added(1), collapsed(7)];

        expect(buildDiffViewText(rows, SIDES).split("\n")).toEqual([
            "m0", //
            "o1",
            "m1",
            "⋯ 7 unchanged lines",
        ]);
    });

    it("строк в документе ровно столько же, сколько строк вью", () => {
        const rows = [unchanged(0, 0), deleted(1), added(1), collapsed(7), unchanged(2, 2)];
        const viewState = createDiffViewState(rows, SIDES, 4);

        expect(viewState.document.lineCount).toBe(rows.length);
    });

    it("строка за пределами своей стороны даёт пустую (снимок мог разъехаться)", () => {
        expect(buildDiffViewText([added(99)], SIDES)).toBe("");
    });
});

describe("diffViewText — состояние вью", () => {
    it("read-only и с явным tabSize: детект отступов по перемешанным сторонам выключен", () => {
        // Стороны с разными отступами: детект выбрал бы что-то одно и разошёлся
        // бы с шириной таба, которой тот же файл рисуется в редакторе.
        const viewState = createDiffViewState([unchanged(0, 0), unchanged(1, 1)], {
            original: ["  a", "  b"],
            modified: ["        a", "        b"],
        }, 4);

        expect(viewState.readOnly).toBe(true);
        expect(viewState.detectIndentation).toBe(false);
        expect(viewState.tabSize).toBe(4);
    });

    it("каретка стартует в начале и ничего не выделено", () => {
        const viewState = createDiffViewState([unchanged(0, 0)], SIDES, 4);

        expect(viewState.selections[0].active).toEqual({ line: 0, character: 0 });
        expect(viewState.getSelectedText()).toBe("");
    });
});
