import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import { HFlexElement, hflexFill, hflexFixed } from "../layout/hFlexElement.ts";
import { TextLabelElement } from "../text/textLabelElement.ts";

import { ListViewElement } from "./listViewElement.ts";

// Регресс-тесты «случая 6» SearchPerformance.md: appendRow при материализованной
// проекции дополняет её инкрементально — push в хвост для append-в-конец и
// append-в-раскрытую хвостовую группу (частый случай стрима результатов поиска),
// полный no-op для строк под свёрнутым/скрытым родителем. Кадр между порциями
// стрима больше не платит DFS-пересборку O(N). Фоллбек на полную пересборку
// остаётся для вставок в середину; collapse/hidden инвалидируют как раньше.

const ICON_EXPANDED = "";

function makeRow(id: string, text = id): TextLabelElement {
    const row = new TextLabelElement(text);
    row.id = id;
    return row;
}

// Строка «имя (fill) + глиф-кнопка (fixed 2)», потребляющая клик через
// preventDefault — как в listViewElement.delegation.test.ts.
function makeButtonRow(id: string, onButton: () => void): HFlexElement {
    const row = new HFlexElement();
    row.id = id;
    const name = new TextLabelElement(id);
    const button = new TextLabelElement("");
    button.addEventListener("click", (event) => {
        event.preventDefault();
        onButton();
    });
    row.addChild(name, { width: hflexFill(), height: 1 });
    row.addChild(button, { width: hflexFixed(2), height: 1 });
    return row;
}

/** Спай на per-row шаг DFS-пересборки: ensureProjection зовёт rowHasChildren по разу на видимую строку. */
function spyOnProjectionRebuild(): ReturnType<typeof vi.spyOn> {
    type ProjectionInternals = { rowHasChildren(id: string): boolean };
    return vi.spyOn(ListViewElement.prototype as unknown as ProjectionInternals, "rowHasChildren");
}

describe("ListViewElement — стоимость append при живой проекции", () => {
    it("append в конец топ-левела не пересобирает проекцию", () => {
        const list = new ListViewElement();
        for (let i = 0; i < 200; i++) list.appendRow(makeRow(`r${i}`));
        TestApp.createWithContent(list, new Size(30, 10));

        const spy = spyOnProjectionRebuild();
        for (let i = 0; i < 50; i++) list.appendRow(makeRow(`s${i}`));
        expect(list.contentHeight).toBe(250);
        // Ноль per-row шагов пересборки — проекция дополнена инкрементально.
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it("append в раскрытую хвостовую группу не пересобирает проекцию", () => {
        const list = new ListViewElement();
        for (let g = 0; g < 5; g++) {
            list.appendRow(makeRow(`g${g}`));
            for (let c = 0; c < 10; c++) list.appendRow(makeRow(`g${g}/c${c}`), { parentId: `g${g}` });
        }
        TestApp.createWithContent(list, new Size(30, 10));

        const spy = spyOnProjectionRebuild();
        // Паттерн стрима поиска: матчи в последнюю группу, затем новая группа.
        for (let i = 0; i < 20; i++) list.appendRow(makeRow(`g4/m${i}`), { parentId: "g4" });
        list.appendRow(makeRow("g5"));
        for (let i = 0; i < 20; i++) list.appendRow(makeRow(`g5/m${i}`), { parentId: "g5" });
        expect(list.contentHeight).toBe(55 + 41);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe("ListViewElement — корректность инкрементального append", () => {
    it("append в середину (не хвостовая группа) — фоллбек на пересборку, порядок DFS верен", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("g1"));
        list.appendRow(makeRow("c1"), { parentId: "g1" });
        list.appendRow(makeRow("g2"));
        list.appendRow(makeRow("c2"), { parentId: "g2" });
        const app = TestApp.createWithContent(list, new Size(20, 6));

        list.appendRow(makeRow("c1b"), { parentId: "g1" });
        app.render();

        expect(list.inspectState()).toMatchObject({ visibleCount: 5 });
        expect(app.backend.getTextAt(new Point(2, 0), 2)).toBe("g1");
        expect(app.backend.getTextAt(new Point(4, 1), 2)).toBe("c1");
        expect(app.backend.getTextAt(new Point(4, 2), 3)).toBe("c1b");
        expect(app.backend.getTextAt(new Point(2, 3), 2)).toBe("g2");
        expect(app.backend.getTextAt(new Point(4, 4), 2)).toBe("c2");
    });

    it("append под свёрнутого родителя не меняет видимые строки; раскрытие показывает всех детей", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("g"));
        list.appendRow(makeRow("c0"), { parentId: "g" });
        TestApp.createWithContent(list, new Size(20, 6));
        list.setCollapsed("g", true);
        expect(list.contentHeight).toBe(1); // материализовать проекцию после collapse

        list.appendRow(makeRow("c1"), { parentId: "g" });
        expect(list.inspectState()).toMatchObject({ visibleCount: 1 });

        list.setCollapsed("g", false);
        expect(list.inspectState()).toMatchObject({ visibleCount: 3 });
        list.focusLast();
        expect(list.getCursorElement()?.id).toBe("c1");
    });

    it("append под скрытого родителя — no-op; показ родителя приносит ребёнка", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("g"));
        list.appendRow(makeRow("c0"), { parentId: "g" });
        list.appendRow(makeRow("tail"));
        TestApp.createWithContent(list, new Size(20, 6));
        list.setRowHidden("g", true);
        expect(list.contentHeight).toBe(1);

        list.appendRow(makeRow("c1"), { parentId: "g" });
        expect(list.inspectState()).toMatchObject({ visibleCount: 1 });

        list.setRowHidden("g", false);
        expect(list.inspectState()).toMatchObject({ visibleCount: 4 });
        list.setCursorTo("c1");
        expect(list.getCursorElement()?.id).toBe("c1");
    });

    it("первый ребёнок строки после кадра: шеврон и гуттер появляются следующим кадром", () => {
        const list = new ListViewElement();
        list.appendRow(makeRow("a", "Alpha"));
        list.appendRow(makeRow("b", "Beta"));
        const app = TestApp.createWithContent(list, new Size(20, 5));
        expect(app.backend.getTextAt(new Point(0, 0), 5)).toBe("Alpha"); // гуттера нет

        list.appendRow(makeRow("b/c", "Child"), { parentId: "b" });
        app.render();

        expect(app.backend.getTextAt(new Point(2, 0), 5)).toBe("Alpha"); // гуттер въехал
        expect(app.backend.getTextAt(new Point(0, 1), 1)).toBe(ICON_EXPANDED);
        expect(app.backend.getTextAt(new Point(2, 1), 4)).toBe("Beta");
        expect(app.backend.getTextAt(new Point(4, 2), 5)).toBe("Child");
    });

    it("делегация кликов переживает append за пределами разложенного окна", () => {
        const onButton = vi.fn();
        const list = new ListViewElement();
        for (let i = 0; i < 8; i++) list.appendRow(makeButtonRow(`r${i}`, onButton));
        TestApp.createWithContent(list, new Size(20, 3));
        list.focus();

        // Индекс 8 ≥ окна [0, 3) — разложенные позиции строк окна всё ещё валидны.
        // (Append ВНУТРЬ окна делегацию выключает — listViewElement.delegation.test.ts.)
        list.appendRow(makeButtonRow("extra", onButton));
        list.dispatchEvent(
            new TUIMouseEvent("click", { button: "left", screenX: 18, screenY: 1, localX: 18, localY: 1 }),
        );

        expect(onButton).toHaveBeenCalledTimes(1);
        expect(list.getCursorElement()?.id).toBe("r0");
    });

    it("якорь Shift-выделения переживает append (полная пересборка его сбрасывала)", () => {
        const list = new ListViewElement();
        for (let i = 0; i < 5; i++) list.appendRow(makeRow(`r${i}`));
        const app = TestApp.createWithContent(list, new Size(20, 10));
        list.focus();
        app.render();

        app.sendKey("ArrowDown"); // курсор и якорь на r1
        list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "ArrowDown", shiftKey: true }));
        expect(list.getSelectedElements().map((el) => el.id)).toEqual(["r1", "r2"]);

        list.appendRow(makeRow("r5"));
        list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "ArrowDown", shiftKey: true }));
        expect(list.getSelectedElements().map((el) => el.id)).toEqual(["r1", "r2", "r3"]);
    });
});
