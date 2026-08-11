import { describe, expect, it } from "vitest";

import { createCursorSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

// ─── Helpers ────────────────────────────────────────────────

function makeState(lines: string): EditorViewState {
    return new EditorViewState(new TextDocument(lines), [createCursorSelection(0, 0)]);
}

/** Вид всех строк вью компактной строкой: номер doc-строки либо `·` у зоны. */
function sketch(state: EditorViewState): string {
    const parts: string[] = [];
    for (let v = 0; v < state.getViewLineCount(); v++) {
        const log = state.visualToLogicalLine(v);
        parts.push(log >= 0 ? String(log) : "·");
    }
    return parts.join(" ");
}

// ─── Проекция ───────────────────────────────────────────────

describe("EditorViewState view zones — проекция", () => {
    it("зона добавляет виртуальные строки после якоря, номера документа не тратя", () => {
        const state = makeState("a\nb\nc");
        state.setViewZones([{ afterLine: 0, size: 2 }]);

        expect(state.getViewLineCount()).toBe(5);
        expect(sketch(state)).toBe("0 · · 1 2");
    });

    it("якорь -1 даёт зону перед первой строкой", () => {
        const state = makeState("a\nb");
        state.setViewZones([{ afterLine: -1, size: 1 }]);

        expect(sketch(state)).toBe("· 0 1");
    });

    it("зона в конце файла и кламп якоря за концом", () => {
        const state = makeState("a\nb");
        state.setViewZones([{ afterLine: 99, size: 2 }]);

        expect(sketch(state)).toBe("0 1 · ·");
    });

    it("несколько зон и слияние одинаковых якорей", () => {
        const state = makeState("a\nb\nc");
        state.setViewZones([
            { afterLine: 1, size: 1 },
            { afterLine: 0, size: 1 },
            { afterLine: 1, size: 2 },
        ]);

        expect(sketch(state)).toBe("0 · 1 · · · 2");
        expect(state.viewZones).toEqual([
            { afterLine: 0, size: 1 },
            { afterLine: 1, size: 3 },
        ]);
    });

    it("пустые зоны выбрасываются, пустой набор возвращает 1:1", () => {
        const state = makeState("a\nb");
        state.setViewZones([{ afterLine: 0, size: 0 }]);
        expect(sketch(state)).toBe("0 1");

        state.setViewZones([{ afterLine: 0, size: 1 }]);
        state.setViewZones([]);
        expect(sketch(state)).toBe("0 1");
    });

    it("viewLineKind различает документные, виртуальные и за-концом строки", () => {
        const state = makeState("a\nb");
        state.setViewZones([{ afterLine: 0, size: 1 }]);

        expect(state.viewLineKind(0)).toBe("doc");
        expect(state.viewLineKind(1)).toBe("zone");
        expect(state.viewLineKind(2)).toBe("doc");
        expect(state.viewLineKind(3)).toBe("none");
        expect(state.viewLineKind(-1)).toBe("none");
    });

    it("visualToLogicalLine на зоне -1, getViewLine — пустая строка", () => {
        const state = makeState("alpha\nbravo");
        state.setViewZones([{ afterLine: 0, size: 1 }]);

        expect(state.visualToLogicalLine(1)).toBe(-1);
        expect(state.getViewLine(1)).toBe("");
        expect(state.getViewLineTokens(1)).toBeUndefined();
        expect(state.getViewLine(2)).toBe("bravo");
    });

    it("logicalToVisualLine учитывает зоны и защищён от отрицательного аргумента", () => {
        const state = makeState("a\nb\nc");
        state.setViewZones([{ afterLine: 0, size: 2 }]);

        expect(state.logicalToVisualLine(1)).toBe(3);
        expect(state.logicalToVisualLine(-1)).toBe(-1);
        expect(state.logicalToVisualLine(-2)).toBe(-1);
    });

    it("docLineForViewLine: сама строка, якорь у зоны, первая строка у зоны до начала", () => {
        const state = makeState("a\nb\nc");
        state.setViewZones([
            { afterLine: -1, size: 1 },
            { afterLine: 1, size: 2 },
        ]);
        // Вью: · 0 1 · · 2

        expect(state.docLineForViewLine(1)).toBe(0);
        expect(state.docLineForViewLine(3)).toBe(1);
        expect(state.docLineForViewLine(4)).toBe(1);
        expect(state.docLineForViewLine(0)).toBe(0);
        expect(state.docLineForViewLine(99)).toBe(2);
        expect(state.docLineForViewLine(-5)).toBe(0);
    });

    it("docLineForViewLine перешагивает многострочную зону до начала файла", () => {
        const state = makeState("a\nb");
        state.setViewZones([{ afterLine: -1, size: 2 }]);
        // Вью: · · 0 1 — ближайшая документная снизу через вторую строку зоны.

        expect(state.docLineForViewLine(0)).toBe(0);
    });
});

// ─── Событие и кэш ──────────────────────────────────────────

describe("EditorViewState view zones — событие и кэш", () => {
    it("setViewZones файрит onDidChangeView один раз; повтор того же набора молчит", () => {
        const state = makeState("a\nb");
        let fired = 0;
        state.onDidChangeView(() => {
            fired++;
        });

        state.setViewZones([{ afterLine: 0, size: 1 }]);
        expect(fired).toBe(1);

        state.setViewZones([{ afterLine: 0, size: 1 }]);
        expect(fired).toBe(1);

        state.setViewZones([{ afterLine: 0, size: 2 }]);
        expect(fired).toBe(2);
        state.setViewZones([]);
        expect(fired).toBe(3);
    });

    it("смена зон инвалидирует кэш проекции при неизменном документе", () => {
        const state = makeState("a\nb\nc");
        expect(state.getViewLineCount()).toBe(3);

        state.setViewZones([{ afterLine: 0, size: 4 }]);
        expect(state.getViewLineCount()).toBe(7);

        state.setViewZones([{ afterLine: 0, size: 1 }]);
        expect(state.getViewLineCount()).toBe(4);
    });
});

// ─── Зоны и фолдинг вместе ──────────────────────────────────

describe("EditorViewState view zones × folding", () => {
    it("зона на скрытом якоре выживает после заголовка свернувшего региона", () => {
        const state = makeState("h\nb1\nb2\ntail");
        state.setFoldingRegions([{ startLine: 0, endLine: 2, isCollapsed: true }]);
        state.setViewZones([{ afterLine: 1, size: 1 }]);

        // Вью: заголовок 0 (тело 1-2 скрыто), зона после него, затем 3.
        expect(sketch(state)).toBe("0 · 3");
    });

    it("развёртка возвращает зону на её якорь", () => {
        const state = makeState("h\nb1\nb2\ntail");
        state.setFoldingRegions([{ startLine: 0, endLine: 2, isCollapsed: true }]);
        state.setViewZones([{ afterLine: 1, size: 1 }]);
        state.toggleFold(0);

        expect(sketch(state)).toBe("0 1 · 2 3");
    });
});

// ─── Каретка и навигация ────────────────────────────────────

describe("EditorViewState view zones — каретка", () => {
    it("зоны на краях файла: каретка с крайних строк никуда не уезжает", () => {
        const state = makeState("a\nb");
        state.setViewZones([
            { afterLine: -1, size: 1 },
            { afterLine: 1, size: 1 },
        ]);
        // Вью: · 0 1 ·

        state.selections = [createCursorSelection(0, 0)];
        state.cursorUp();
        expect(state.selections[0].active.line).toBe(0);

        state.selections = [createCursorSelection(1, 0)];
        state.cursorDown();
        expect(state.selections[0].active.line).toBe(1);
    });

    it("cursorDown/Up проскакивают зону: каретка не встаёт на виртуальную строку", () => {
        const state = makeState("a\nb\nc");
        state.setViewZones([{ afterLine: 0, size: 3 }]);
        state.selections = [createCursorSelection(0, 0)];

        state.cursorDown();
        expect(state.selections[0].active.line).toBe(1);

        state.cursorUp();
        expect(state.selections[0].active.line).toBe(0);
    });

    it("PageDown шагает по строкам вью: зоны съедают страницу, как на экране", () => {
        const state = makeState(Array.from({ length: 20 }, (_, i) => `l${String(i)}`).join("\n"));
        state.viewportHeight = 6; // pageSize 5
        state.setViewZones([{ afterLine: 1, size: 3 }]);
        state.selections = [createCursorSelection(0, 0)];

        state.cursorPageDown();
        // Вью: 0 1 · · · 2 3 …; страница = 5 строк вью → view 5 → doc 2.
        expect(state.selections[0].active.line).toBe(2);

        state.cursorPageUp();
        expect(state.selections[0].active.line).toBe(0);
    });

    it("PageDown с целью на зоне встаёт на ближайшую документную строку", () => {
        const state = makeState(Array.from({ length: 10 }, (_, i) => `l${String(i)}`).join("\n"));
        state.viewportHeight = 4; // pageSize 3
        state.setViewZones([{ afterLine: 2, size: 2 }]);
        state.selections = [createCursorSelection(0, 0)];

        state.cursorPageDown();
        // Вью: 0 1 2 · · 3 …; цель view 3 — зона → ближайшая документная 2.
        expect(state.selections[0].active.line).toBe(2);
    });

    it("PageUp/Down без зон ведут себя как раньше", () => {
        const state = makeState(Array.from({ length: 12 }, (_, i) => `l${String(i)}`).join("\n"));
        state.viewportHeight = 5; // pageSize 4
        state.selections = [createCursorSelection(0, 0)];

        state.cursorPageDown();
        expect(state.selections[0].active.line).toBe(4);
        state.cursorPageDown();
        expect(state.selections[0].active.line).toBe(8);
        state.cursorPageUp();
        expect(state.selections[0].active.line).toBe(4);
    });

    it("revealPosition считает в строках вью — зоны выше каретки учтены", () => {
        const state = makeState(Array.from({ length: 30 }, (_, i) => `l${String(i)}`).join("\n"));
        state.viewportHeight = 5;
        state.setViewZones([{ afterLine: 0, size: 10 }]);

        state.goToPosition(20, 0);
        // Каретка на doc 20 = view 30; вьюпорт обязан доехать.
        const caretView = state.logicalToVisualLine(20);
        expect(caretView).toBe(30);
        expect(state.scrollTop).toBeGreaterThan(caretView - state.viewportHeight);
        expect(state.scrollTop).toBeLessThanOrEqual(caretView);
    });
});

describe("EditorViewState — скрытая каретка на краю (регресс индирекции)", () => {
    it("cursorDown со скрытой строки хвостового региона остаётся на месте", () => {
        const state = makeState("a\nh\nb1\nb2");
        state.setFoldingRegions([{ startLine: 1, endLine: 3, isCollapsed: true }]);
        // Каретку на скрытую строку кладём напрямую: сеттер selections не
        // выправляет её (это делает reconcile после фолд-команд) — ровно так
        // выглядит момент между схлопыванием и выправкой.
        state.selections = [createCursorSelection(2, 0)];

        state.cursorDown();

        expect(state.selections[0].active.line).toBe(2);
    });
});

// ─── Правки документа ───────────────────────────────────────

describe("EditorViewState view zones — правки документа", () => {
    it("своя правка выше якоря сдвигает зону", () => {
        const state = makeState("a\nb\nc");
        state.setViewZones([{ afterLine: 1, size: 1 }]);
        state.selections = [createCursorSelection(0, 1)];

        state.type("\n");
        expect(state.viewZones).toEqual([{ afterLine: 2, size: 1 }]);
        expect(sketch(state)).toBe("0 1 2 · 3");
    });

    it("правка ниже якоря зону не трогает", () => {
        const state = makeState("a\nb\nc");
        state.setViewZones([{ afterLine: 0, size: 1 }]);
        state.selections = [createCursorSelection(2, 1)];

        state.type("\n");
        expect(state.viewZones).toEqual([{ afterLine: 0, size: 1 }]);
    });

    it("удаление строк с якорем клампит якорь внутрь нового диапазона", () => {
        const state = makeState("a\nb\nc\nd\ne");
        state.setViewZones([{ afterLine: 2, size: 1 }]);
        // Выделить строки 1..3 целиком и удалить.
        state.selections = [{ anchor: { line: 1, character: 0 }, active: { line: 4, character: 0 } }];
        state.deleteLeft();

        const zones = state.viewZones;
        expect(zones).toHaveLength(1);
        expect(zones[0].afterLine).toBeLessThanOrEqual(1);
        expect(state.getViewLineCount()).toBe(2 + zones[0].size);
    });

    it("правка, кламп которой не двигает якорь, оставляет зону тем же объектом", () => {
        const state = makeState("a\nb\nc\nd");
        state.setViewZones([{ afterLine: 1, size: 1 }]);
        const before = state.viewZones[0];
        // Удаление диапазона [1..2): editStartLine 1, кламп якоря 1 → 1.
        state.selections = [{ anchor: { line: 1, character: 0 }, active: { line: 2, character: 0 } }];
        state.deleteLeft();

        expect(state.viewZones[0].afterLine).toBe(before.afterLine);
        expect(state.viewZones[0].size).toBe(1);
    });

    it("чужая правка (remap) выше вьюпорта не двигает scrollTop при зонах", () => {
        const doc = new TextDocument(Array.from({ length: 30 }, (_, i) => `l${String(i)}`).join("\n"));
        const state = new EditorViewState(doc, [createCursorSelection(20, 0)]);
        state.viewportHeight = 5;
        state.scrollTop = 15;
        state.setViewZones([{ afterLine: 25, size: 1 }]);

        // Чужая правка: вставка строки в начале (мимо мутаторов этого view-state).
        doc.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "x\n" }]);

        // Гейт: с зонами логический сдвиг ≠ визуальному — скролл не трогаем.
        expect(state.scrollTop).toBe(15);
        // А якорь зоны — сдвинут.
        expect(state.viewZones).toEqual([{ afterLine: 26, size: 1 }]);
    });
});
